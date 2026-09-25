import { EmailConfigurationError, type EmailProvider } from './types';

export type EmailEnv = Record<string, string | undefined>;

export type EmailChannelName = 'marketing' | 'system' | 'trustPortal' | 'default';

function read(env: EmailEnv, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * EMAIL_PROVIDER wins when set. Otherwise Cloudflare if its token is present,
 * then Resend if its key is present. Returns undefined when nothing is configured.
 */
export function resolveEmailProvider(env: EmailEnv = process.env): EmailProvider | undefined {
  const explicit = read(env, 'EMAIL_PROVIDER')?.toLowerCase();
  if (explicit === 'cloudflare' || explicit === 'resend') return explicit;
  if (explicit) {
    throw new EmailConfigurationError(
      `Invalid EMAIL_PROVIDER "${explicit}". Use "cloudflare" or "resend".`,
    );
  }
  if (read(env, 'CLOUDFLARE_EMAIL_API_TOKEN')) return 'cloudflare';
  if (read(env, 'RESEND_API_KEY')) return 'resend';
  return undefined;
}

/** Sender address for a channel. New EMAIL_FROM_* names win over the legacy RESEND_FROM_* names. */
export function resolveFromAddress(params: {
  channel: EmailChannelName | undefined;
  env?: EmailEnv;
}): string | undefined {
  const env = params.env ?? process.env;
  const system = read(env, 'EMAIL_FROM_SYSTEM', 'RESEND_FROM_SYSTEM');
  switch (params.channel) {
    case 'marketing':
      return read(env, 'EMAIL_FROM_MARKETING', 'RESEND_FROM_MARKETING');
    case 'system':
      return system;
    case 'trustPortal':
      return read(env, 'EMAIL_FROM_TRUST_PORTAL', 'RESEND_FROM_TRUST_PORTAL') ?? system;
    case 'default':
      return read(env, 'EMAIL_FROM_DEFAULT', 'RESEND_FROM_DEFAULT');
    default:
      return undefined;
  }
}

/**
 * Reply-To address. EMAIL_REPLY_TO applies to every send (so replies land in the
 * support mailbox); the legacy RESEND_REPLY_TO_MARKETING applies to marketing only.
 */
export function resolveReplyTo(params: {
  marketing?: boolean;
  env?: EmailEnv;
}): string | undefined {
  const env = params.env ?? process.env;
  const replyTo = read(env, 'EMAIL_REPLY_TO');
  if (replyTo) return replyTo;
  return params.marketing ? read(env, 'RESEND_REPLY_TO_MARKETING') : undefined;
}

/** When set, every email is redirected to this address (non-production testing). */
export function resolveTestRecipient(env: EmailEnv = process.env): string | undefined {
  return read(env, 'EMAIL_TO_TEST', 'RESEND_TO_TEST');
}

/** Marketing sends are off on Cloudflare unless EMAIL_ALLOW_MARKETING=true. */
export function assertMarketingAllowed(params: {
  provider: EmailProvider;
  marketing?: boolean;
  env?: EmailEnv;
}): void {
  if (!params.marketing || params.provider !== 'cloudflare') return;
  const env = params.env ?? process.env;
  if (read(env, 'EMAIL_ALLOW_MARKETING')?.toLowerCase() === 'true') return;
  throw new EmailConfigurationError(
    'Marketing emails are disabled for the Cloudflare provider. Set EMAIL_ALLOW_MARKETING=true to allow them.',
  );
}
