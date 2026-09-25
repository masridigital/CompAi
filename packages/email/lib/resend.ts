import { render, toPlainText } from '@react-email/render';
import { randomUUID } from 'node:crypto';
import { deliverEmail, getEmailTransport } from './transport';
import { resolveFromAddress, resolveReplyTo, resolveTestRecipient } from './transport/config';

// File name kept for backwards compatibility: `sendEmail` now goes through the
// provider-agnostic transport (Cloudflare Email Service or Resend).

function maskEmail(value: string): string {
  const [name = '', domain = ''] = value.toLowerCase().split('@');
  if (!domain) return 'invalid-email';
  const safeName =
    name.length <= 2 ? (name[0] ?? '') : `${name[0]}${'*'.repeat(name.length - 2)}${name.at(-1)}`;
  return `${safeName}@${domain}`;
}

function maskEmailList(value: string): string {
  return value
    .split(',')
    .map((email) => maskEmail(email.trim()))
    .join(', ');
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export const sendEmail = async ({
  to,
  subject,
  react,
  marketing,
  system,
  test,
  cc,
  scheduledAt,
  attachments,
}: {
  to: string;
  subject: string;
  react: React.ReactNode;
  marketing?: boolean;
  system?: boolean;
  test?: boolean;
  cc?: string | string[];
  scheduledAt?: string;
  attachments?: EmailAttachment[];
}) => {
  const transport = getEmailTransport();

  const fromAddress = resolveFromAddress({
    channel: marketing ? 'marketing' : system ? 'system' : 'default',
  });
  const toAddress = test ? resolveTestRecipient() : to;
  const replyTo = resolveReplyTo({ marketing });

  if (!fromAddress) {
    throw new Error('Missing FROM address in environment variables');
  }
  if (!toAddress) {
    throw new Error('Missing TO address in environment variables');
  }

  const requestId = randomUUID();
  const startTime = Date.now();

  try {
    console.info('[email] send start', {
      requestId,
      provider: transport.provider,
      from: fromAddress,
      to: maskEmailList(toAddress),
      subject,
      scheduledAt,
      flags: {
        marketing: Boolean(marketing),
        system: Boolean(system),
        test: Boolean(test),
      },
    });

    const html = await render(react);
    const result = await deliverEmail({
      transport,
      marketing,
      message: {
        from: fromAddress,
        to: toAddress,
        cc,
        replyTo,
        subject,
        html,
        text: toPlainText(html),
        scheduledAt,
        attachments,
      },
    });

    console.info('[email] send success', {
      requestId,
      provider: transport.provider,
      to: maskEmailList(toAddress),
      messageId: result.id,
      durationMs: Date.now() - startTime,
    });

    return {
      message: 'Email sent successfully',
      id: result.id,
    };
  } catch (error) {
    console.error('[email] send failure', {
      requestId,
      provider: transport.provider,
      to: maskEmailList(toAddress),
      durationMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error instanceof Error ? error : new Error('Failed to send email');
  }
};
