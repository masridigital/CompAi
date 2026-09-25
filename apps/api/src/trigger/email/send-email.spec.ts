import { z } from 'zod';

const mockWaitUntil = jest.fn();
jest.mock('@trigger.dev/sdk', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  queue: (config: unknown) => config,
  schemaTask: (config: unknown) => config,
  wait: { until: (...args: unknown[]) => mockWaitUntil(...args) },
}));

import { sendEmailTask } from './send-email';
import { sendBatchEmailTask } from './send-batch-email';
import { scheduledAtToDelay } from './list-unsubscribe';

type SendEmailPayload = z.input<typeof sendEmailTask.schema>;
type BatchPayload = z.input<typeof sendBatchEmailTask.schema>;

// schemaTask is mocked to return its config, so `run` is the raw handler.
const runSendEmail = (payload: SendEmailPayload) =>
  (
    sendEmailTask as unknown as {
      run: (p: SendEmailPayload) => Promise<{ id: string }>;
    }
  ).run(payload);
const runBatch = (payload: BatchPayload) =>
  (
    sendBatchEmailTask as unknown as {
      run: (
        p: BatchPayload,
      ) => Promise<{ totalSent: number; totalFailed: number }>;
    }
  ).run(payload);

const requestBodySchema = z.object({
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  reply_to: z.string().optional(),
  headers: z.record(z.string(), z.string()),
});

const ENV = {
  CLOUDFLARE_ACCOUNT_ID: 'acct',
  CLOUDFLARE_EMAIL_API_TOKEN: 'tok',
  EMAIL_FROM_SYSTEM: 'Masri Compliance <no-reply@compliance.masri.tech>',
  EMAIL_REPLY_TO: 'support@masri.tech',
};
const CLEARED = [
  'EMAIL_PROVIDER',
  'RESEND_API_KEY',
  'RESEND_TO_TEST',
  'EMAIL_TO_TEST',
  'RESEND_FROM_SYSTEM',
  'RESEND_FROM_DEFAULT',
  'EMAIL_FROM_DEFAULT',
  'EMAIL_ALLOW_MARKETING',
];

function cloudflareOk(id: string): Response {
  return new Response(
    JSON.stringify({
      success: true,
      errors: [],
      result: {
        message_id: id,
        delivered: ['x'],
        permanent_bounces: [],
        queued: [],
      },
    }),
    { status: 200 },
  );
}

describe('email trigger tasks (Cloudflare transport)', () => {
  const originalEnv = process.env;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    process.env = { ...originalEnv, ...ENV };
    for (const key of CLEARED) delete process.env[key];
    fetchMock = jest.spyOn(global, 'fetch');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    mockWaitUntil.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    fetchMock.mockRestore();
    process.env = originalEnv;
  });

  const flush = async <T>(promise: Promise<T>): Promise<T> => {
    await jest.runAllTimersAsync();
    return promise;
  };

  it('send-email posts to Cloudflare with List-Unsubscribe headers', async () => {
    fetchMock.mockResolvedValueOnce(cloudflareOk('cf-123'));

    const result = await flush(
      runSendEmail({
        to: 'user@example.com',
        subject: 'Hi',
        html: '<p>Hello</p>',
        channel: 'system',
      }),
    );

    expect(result).toEqual({ id: 'cf-123' });
    expect(mockWaitUntil).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct/email/sending/send',
    );
    const body = requestBodySchema.parse(JSON.parse(String(init?.body)));
    expect(body.from).toBe(ENV.EMAIL_FROM_SYSTEM);
    expect(body.to).toEqual(['user@example.com']);
    expect(body.reply_to).toBe('support@masri.tech');
    expect(body.text).toContain('Hello');
    expect(body.headers['List-Unsubscribe']).toMatch(
      /^<.*\/v1\/email\/unsubscribe\?email=user%40example\.com&token=.+>$/,
    );
    expect(body.headers['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    );
  });

  it('send-email waits until a future scheduledAt before sending', async () => {
    fetchMock.mockResolvedValueOnce(cloudflareOk('cf-later'));
    const scheduledAt = new Date(Date.now() + 3_600_000).toISOString();

    await flush(
      runSendEmail({
        to: 'u@example.com',
        subject: 'S',
        html: '<p>x</p>',
        scheduledAt,
      }),
    );

    expect(mockWaitUntil).toHaveBeenCalledWith({ date: new Date(scheduledAt) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('send-email refuses marketing on Cloudflare', async () => {
    process.env.EMAIL_FROM_MARKETING = 'm@example.com';
    // Rejects before any timer runs, so no flush is needed.
    await expect(
      runSendEmail({
        to: 'u@example.com',
        subject: 'S',
        html: '<p>x</p>',
        channel: 'marketing',
      }),
    ).rejects.toThrow('EMAIL_ALLOW_MARKETING');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('send-batch-email sends individually and counts failures', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const body = requestBodySchema.parse(JSON.parse(String(init?.body)));
      if (body.to[0] === 'bad@example.com') {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 1, message: 'invalid' }],
          }),
          { status: 400 },
        );
      }
      return cloudflareOk(`id-${body.to[0]}`);
    });

    const emails = ['a@example.com', 'bad@example.com', 'c@example.com'].map(
      (to) => ({
        to,
        subject: 'S',
        html: '<p>x</p>',
      }),
    );
    const result = await flush(runBatch({ emails }));

    expect(result).toEqual({ totalSent: 2, totalFailed: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('scheduledAtToDelay', () => {
  it('returns a Date only for valid future timestamps', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(scheduledAtToDelay(future)).toEqual(new Date(future));
    expect(
      scheduledAtToDelay(new Date(Date.now() - 60_000).toISOString()),
    ).toBeUndefined();
    expect(scheduledAtToDelay('not-a-date')).toBeUndefined();
    expect(scheduledAtToDelay(undefined)).toBeUndefined();
  });
});
