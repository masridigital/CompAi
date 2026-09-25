import { toPlainText } from '@react-email/render';
import { createCloudflareTransport } from './cloudflare';
import { assertMarketingAllowed, resolveEmailProvider, type EmailEnv } from './config';
import { createResendTransport } from './resend';
import {
  EmailConfigurationError,
  type EmailMessage,
  type EmailSendResult,
  type EmailTransport,
} from './types';

export { buildCloudflarePayload, createCloudflareTransport } from './cloudflare';
export {
  chunkRecipients,
  CLOUDFLARE_MAX_MESSAGE_BYTES,
  CLOUDFLARE_MAX_RECIPIENTS,
} from './cloudflare-utils';
export * from './config';
export { createResendTransport } from './resend';
export * from './types';

/** Builds the transport for the configured provider. Throws when no provider is configured. */
export function getEmailTransport(env: EmailEnv = process.env): EmailTransport {
  const provider = resolveEmailProvider(env);

  if (provider === 'cloudflare') {
    return createCloudflareTransport({
      accountId: env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '',
      apiToken: env.CLOUDFLARE_EMAIL_API_TOKEN?.trim() ?? '',
    });
  }
  if (provider === 'resend') {
    return createResendTransport({ apiKey: env.RESEND_API_KEY?.trim() ?? '' });
  }
  throw new EmailConfigurationError(
    'No email provider configured. Set CLOUDFLARE_EMAIL_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID) or RESEND_API_KEY.',
  );
}

export type DeliverableEmail = Omit<EmailMessage, 'text'> & { text?: string };

/**
 * Sends an already-rendered email through the configured transport. Derives the
 * plain-text part from the HTML when missing and enforces the marketing policy.
 */
export async function deliverEmail(params: {
  message: DeliverableEmail;
  marketing?: boolean;
  env?: EmailEnv;
  transport?: EmailTransport;
}): Promise<EmailSendResult & { provider: EmailTransport['provider'] }> {
  const env = params.env ?? process.env;
  const transport = params.transport ?? getEmailTransport(env);
  assertMarketingAllowed({ provider: transport.provider, marketing: params.marketing, env });

  const text = params.message.text ?? toPlainText(params.message.html);
  const result = await transport.send({ ...params.message, text });
  return { ...result, provider: transport.provider };
}
