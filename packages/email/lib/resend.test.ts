import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { sendEmail } from './resend';

const { resendSend } = vi.hoisted(() => ({ resendSend: vi.fn() }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

const ENV_KEYS = [
  'EMAIL_PROVIDER',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_EMAIL_API_TOKEN',
  'RESEND_API_KEY',
  'EMAIL_FROM_DEFAULT',
  'RESEND_FROM_DEFAULT',
  'RESEND_FROM_MARKETING',
  'EMAIL_REPLY_TO',
  'EMAIL_ALLOW_MARKETING',
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resendSend.mockReset();
});

const react = React.createElement('p', null, 'Hello world');

describe('sendEmail provider switch', () => {
  it('sends through Cloudflare with rendered html + text', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_EMAIL_API_TOKEN = 'tok';
    process.env.EMAIL_FROM_DEFAULT = 'notifications@compliance.masri.tech';
    process.env.EMAIL_REPLY_TO = 'support@masri.tech';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          errors: [],
          result: { message_id: 'cf-1', delivered: ['u@x.com'], permanent_bounces: [], queued: [] },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendEmail({ to: 'u@x.com', subject: 'Hi', react });

    expect(result).toEqual({ message: 'Email sent successfully', id: 'cf-1' });
    const init = fetchMock.mock.calls[0]?.[1];
    const body = z
      .object({
        from: z.string(),
        to: z.array(z.string()),
        html: z.string(),
        text: z.string(),
        reply_to: z.string(),
      })
      .parse(JSON.parse(String(init?.body)));
    expect(body.from).toBe('notifications@compliance.masri.tech');
    expect(body.to).toEqual(['u@x.com']);
    expect(body.html).toContain('Hello world');
    expect(body.text).toContain('Hello world');
    expect(body.reply_to).toBe('support@masri.tech');
    expect(resendSend).not.toHaveBeenCalled();
  });

  it('sends through Resend when EMAIL_PROVIDER=resend', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_123';
    process.env.RESEND_FROM_DEFAULT = 'legacy@x.com';
    resendSend.mockResolvedValue({ data: { id: 'rs-1' }, error: null });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendEmail({ to: 'u@x.com', subject: 'Hi', react });

    expect(result.id).toBe('rs-1');
    expect(resendSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'legacy@x.com', to: ['u@x.com'], subject: 'Hi' }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses marketing on Cloudflare', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_EMAIL_API_TOKEN = 'tok';
    process.env.RESEND_FROM_MARKETING = 'm@x.com';
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendEmail({ to: 'u@x.com', subject: 'Hi', react, marketing: true }),
    ).rejects.toThrow('EMAIL_ALLOW_MARKETING');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws a clear error when no provider is configured', async () => {
    await expect(sendEmail({ to: 'u@x.com', subject: 'Hi', react })).rejects.toThrow(
      'No email provider configured',
    );
  });
});
