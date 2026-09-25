import { describe, expect, it, vi } from 'vitest';
import {
  assertMarketingAllowed,
  deliverEmail,
  getEmailTransport,
  resolveEmailProvider,
  resolveFromAddress,
  resolveReplyTo,
  resolveTestRecipient,
  type EmailMessage,
  type EmailTransport,
} from './index';

function fakeTransport(provider: EmailTransport['provider']) {
  const sent: EmailMessage[] = [];
  const transport: EmailTransport = {
    provider,
    send: vi.fn(async (message: EmailMessage) => {
      sent.push(message);
      return { id: 'id-1', ids: ['id-1'] };
    }),
  };
  return { transport, sent };
}

describe('resolveEmailProvider', () => {
  it('honors explicit EMAIL_PROVIDER', () => {
    expect(
      resolveEmailProvider({ EMAIL_PROVIDER: 'resend', CLOUDFLARE_EMAIL_API_TOKEN: 't' }),
    ).toBe('resend');
    expect(resolveEmailProvider({ EMAIL_PROVIDER: 'Cloudflare' })).toBe('cloudflare');
  });

  it('defaults to cloudflare when its token is set, then resend', () => {
    expect(resolveEmailProvider({ CLOUDFLARE_EMAIL_API_TOKEN: 't', RESEND_API_KEY: 'r' })).toBe(
      'cloudflare',
    );
    expect(resolveEmailProvider({ RESEND_API_KEY: 'r' })).toBe('resend');
    expect(resolveEmailProvider({})).toBeUndefined();
  });

  it('rejects an unknown EMAIL_PROVIDER', () => {
    expect(() => resolveEmailProvider({ EMAIL_PROVIDER: 'ses' })).toThrow('Invalid EMAIL_PROVIDER');
  });
});

describe('getEmailTransport', () => {
  it('builds the matching transport', () => {
    expect(
      getEmailTransport({ CLOUDFLARE_EMAIL_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' }).provider,
    ).toBe('cloudflare');
    expect(getEmailTransport({ RESEND_API_KEY: 're_123' }).provider).toBe('resend');
  });

  it('throws when nothing is configured', () => {
    expect(() => getEmailTransport({})).toThrow('No email provider configured');
  });

  it('throws when cloudflare is chosen without an account id', () => {
    expect(() => getEmailTransport({ CLOUDFLARE_EMAIL_API_TOKEN: 't' })).toThrow(
      'CLOUDFLARE_ACCOUNT_ID',
    );
  });
});

describe('address resolution', () => {
  it('prefers EMAIL_FROM_* over RESEND_FROM_*', () => {
    const env = {
      EMAIL_FROM_SYSTEM: 'new-system@x',
      RESEND_FROM_SYSTEM: 'old-system@x',
      RESEND_FROM_DEFAULT: 'old-default@x',
      RESEND_FROM_MARKETING: 'old-marketing@x',
    };
    expect(resolveFromAddress({ channel: 'system', env })).toBe('new-system@x');
    expect(resolveFromAddress({ channel: 'default', env })).toBe('old-default@x');
    expect(resolveFromAddress({ channel: 'marketing', env })).toBe('old-marketing@x');
    expect(resolveFromAddress({ channel: 'trustPortal', env })).toBe('new-system@x');
    expect(resolveFromAddress({ channel: undefined, env })).toBeUndefined();
  });

  it('resolves reply-to and test recipient with fallbacks', () => {
    expect(resolveReplyTo({ env: { EMAIL_REPLY_TO: 'help@x' } })).toBe('help@x');
    expect(resolveReplyTo({ env: { RESEND_REPLY_TO_MARKETING: 'm@x' } })).toBeUndefined();
    expect(resolveReplyTo({ marketing: true, env: { RESEND_REPLY_TO_MARKETING: 'm@x' } })).toBe(
      'm@x',
    );
    expect(resolveTestRecipient({ RESEND_TO_TEST: 't@x' })).toBe('t@x');
    expect(resolveTestRecipient({ EMAIL_TO_TEST: 'n@x', RESEND_TO_TEST: 't@x' })).toBe('n@x');
  });
});

describe('marketing policy', () => {
  it('refuses marketing on cloudflare unless EMAIL_ALLOW_MARKETING=true', () => {
    expect(() =>
      assertMarketingAllowed({ provider: 'cloudflare', marketing: true, env: {} }),
    ).toThrow('EMAIL_ALLOW_MARKETING');
    expect(() =>
      assertMarketingAllowed({
        provider: 'cloudflare',
        marketing: true,
        env: { EMAIL_ALLOW_MARKETING: 'true' },
      }),
    ).not.toThrow();
    expect(() =>
      assertMarketingAllowed({ provider: 'resend', marketing: true, env: {} }),
    ).not.toThrow();
    expect(() => assertMarketingAllowed({ provider: 'cloudflare', env: {} })).not.toThrow();
  });
});

describe('deliverEmail', () => {
  const message = { from: 'f@x', to: 'u@x', subject: 'S', html: '<p>Hello <b>there</b></p>' };

  it('derives a plain-text part from html', async () => {
    const { transport, sent } = fakeTransport('cloudflare');
    const result = await deliverEmail({ message, transport, env: {} });
    expect(result).toEqual({ id: 'id-1', ids: ['id-1'], provider: 'cloudflare' });
    expect(sent[0]?.text).toContain('Hello');
    expect(sent[0]?.text).not.toContain('<p>');
  });

  it('blocks marketing on cloudflare before sending', async () => {
    const { transport } = fakeTransport('cloudflare');
    await expect(deliverEmail({ message, transport, marketing: true, env: {} })).rejects.toThrow(
      'Marketing emails are disabled',
    );
    expect(transport.send).not.toHaveBeenCalled();
  });
});
