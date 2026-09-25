import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createCloudflareTransport, type FetchLike } from './cloudflare';
import { chunkRecipients, parseRetryAfterMs } from './cloudflare-utils';
import { EmailProviderError, EmailValidationError, type EmailMessage } from './types';

const ACCOUNT = 'acct123';
const TOKEN = 'secret-token';

function okResponse(messageId = 'msg_1'): Response {
  return new Response(
    JSON.stringify({
      success: true,
      errors: [],
      messages: [],
      result: { message_id: messageId, delivered: ['a@x.com'], permanent_bounces: [], queued: [] },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function errorResponse(params: { status: number; headers?: Record<string, string> }): Response {
  return new Response(
    JSON.stringify({ success: false, errors: [{ code: 10000, message: 'nope' }], result: null }),
    { status: params.status, headers: { 'content-type': 'application/json', ...params.headers } },
  );
}

function baseMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    from: 'Masri Compliance <no-reply@compliance.masri.tech>',
    to: 'user@example.com',
    subject: 'Hello',
    html: '<p>Hi</p>',
    text: 'Hi',
    ...overrides,
  };
}

function setup(responses: Response[]) {
  const fetchImpl = vi.fn<FetchLike>();
  for (const response of responses) fetchImpl.mockResolvedValueOnce(response);
  const sleep = vi.fn(async (_ms: number) => undefined);
  const transport = createCloudflareTransport({
    accountId: ACCOUNT,
    apiToken: TOKEN,
    fetchImpl,
    sleep,
  });
  return { fetchImpl, sleep, transport };
}

function bodyOf(call: Parameters<FetchLike> | undefined): Record<string, unknown> {
  const init = call?.[1];
  if (!init || typeof init.body !== 'string') throw new Error('missing body');
  return z.record(z.string(), z.unknown()).parse(JSON.parse(init.body));
}

describe('createCloudflareTransport', () => {
  it('posts the documented request shape', async () => {
    const { fetchImpl, transport } = setup([okResponse('msg_abc')]);

    const result = await transport.send(
      baseMessage({
        cc: ['cc@example.com'],
        bcc: 'bcc@example.com',
        replyTo: 'support@masri.tech',
        headers: { 'List-Unsubscribe': '<https://x/unsub>' },
        attachments: [
          { filename: 'a.pdf', content: Buffer.from('hello'), contentType: 'application/pdf' },
          { filename: 'b.txt', content: 'aGk=' },
        ],
      }),
    );

    expect(result).toEqual({ id: 'msg_abc', ids: ['msg_abc'] });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/email/sending/send`);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    });
    expect(bodyOf(fetchImpl.mock.calls[0])).toEqual({
      from: 'Masri Compliance <no-reply@compliance.masri.tech>',
      to: ['user@example.com'],
      cc: ['cc@example.com'],
      bcc: ['bcc@example.com'],
      reply_to: 'support@masri.tech',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
      headers: { 'List-Unsubscribe': '<https://x/unsub>' },
      attachments: [
        {
          content: Buffer.from('hello').toString('base64'),
          filename: 'a.pdf',
          type: 'application/pdf',
          disposition: 'attachment',
        },
        {
          content: 'aGk=',
          filename: 'b.txt',
          type: 'application/octet-stream',
          disposition: 'attachment',
        },
      ],
    });
  });

  it('splits more than 50 recipients into multiple requests', async () => {
    const to = Array.from({ length: 60 }, (_, i) => `to${i}@example.com`);
    const cc = Array.from({ length: 45 }, (_, i) => `cc${i}@example.com`);
    const { fetchImpl, transport } = setup([okResponse('m1'), okResponse('m2'), okResponse('m3')]);

    const result = await transport.send(baseMessage({ to, cc }));

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.ids).toEqual(['m1', 'm2', 'm3']);
    const sizes = fetchImpl.mock.calls.map((call) => {
      const body = bodyOf(call);
      const count = (key: string) => {
        const value = body[key];
        return Array.isArray(value) ? value.length : 0;
      };
      return count('to') + count('cc') + count('bcc');
    });
    expect(sizes).toEqual([50, 50, 5]);
  });

  it('rejects messages over 4.5 MiB before calling the API', async () => {
    const { fetchImpl, transport } = setup([]);
    const big = Buffer.alloc(3.5 * 1024 * 1024); // ~4.67 MiB once base64-encoded

    await expect(
      transport.send(baseMessage({ attachments: [{ filename: 'big.bin', content: big }] })),
    ).rejects.toThrow(/over the 4\.5 MiB limit/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('retries 429 honoring Retry-After, then succeeds', async () => {
    const { fetchImpl, sleep, transport } = setup([
      errorResponse({ status: 429, headers: { 'retry-after': '2' } }),
      okResponse('after-retry'),
    ]);

    const result = await transport.send(baseMessage());

    expect(result.id).toBe('after-retry');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('gives up after 3 attempts on repeated 5xx', async () => {
    const { fetchImpl, transport } = setup([
      errorResponse({ status: 503 }),
      errorResponse({ status: 502 }),
      errorResponse({ status: 500 }),
    ]);

    await expect(transport.send(baseMessage())).rejects.toBeInstanceOf(EmailProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry 4xx and maps Cloudflare errors into the message', async () => {
    const { fetchImpl, transport } = setup([errorResponse({ status: 400 })]);

    await expect(transport.send(baseMessage())).rejects.toThrow(
      'Cloudflare email send failed (HTTP 400): 10000: nope',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never includes the API token in error messages', async () => {
    const { transport } = setup([errorResponse({ status: 403 })]);
    await expect(transport.send(baseMessage())).rejects.not.toThrow(TOKEN);
  });

  it('rejects a future scheduledAt', async () => {
    const { transport } = setup([]);
    const future = new Date(Date.now() + 60_000).toISOString();
    await expect(transport.send(baseMessage({ scheduledAt: future }))).rejects.toBeInstanceOf(
      EmailValidationError,
    );
  });

  it('requires account id and token', () => {
    expect(() => createCloudflareTransport({ accountId: '', apiToken: TOKEN })).toThrow(
      'CLOUDFLARE_ACCOUNT_ID',
    );
    expect(() => createCloudflareTransport({ accountId: ACCOUNT, apiToken: '' })).toThrow(
      'CLOUDFLARE_EMAIL_API_TOKEN',
    );
  });
});

describe('cloudflare utils', () => {
  it('chunkRecipients keeps roles', () => {
    expect(chunkRecipients({ to: ['a', 'b'], cc: 'c', bcc: ['d'], limit: 3 })).toEqual([
      { to: ['a', 'b'], cc: ['c'], bcc: [] },
      { to: [], cc: [], bcc: ['d'] },
    ]);
  });

  it('parseRetryAfterMs handles seconds and HTTP dates', () => {
    expect(parseRetryAfterMs({ header: '3' })).toBe(3000);
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfterMs({ header: 'Thu, 01 Jan 2026 00:00:05 GMT', now })).toBe(5000);
    expect(parseRetryAfterMs({ header: null })).toBeUndefined();
  });
});
