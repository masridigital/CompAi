import { Resend } from 'resend';
import {
  EmailConfigurationError,
  EmailProviderError,
  toList,
  type EmailMessage,
  type EmailSendResult,
  type EmailTransport,
} from './types';

export interface ResendTransportOptions {
  apiKey: string;
  client?: Pick<Resend, 'emails'>;
}

export function createResendTransport(options: ResendTransportOptions): EmailTransport {
  if (!options.apiKey && !options.client) {
    throw new EmailConfigurationError('RESEND_API_KEY is not set');
  }
  const client = options.client ?? new Resend(options.apiKey);

  return {
    provider: 'resend',
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const cc = toList(message.cc);
      const bcc = toList(message.bcc);
      const { data, error } = await client.emails.send({
        from: message.from,
        to: toList(message.to),
        cc: cc.length > 0 ? cc : undefined,
        bcc: bcc.length > 0 ? bcc : undefined,
        replyTo: message.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
        scheduledAt: message.scheduledAt,
        attachments: message.attachments?.map((att) => ({
          filename: att.filename,
          content: att.content,
          contentType: att.contentType,
        })),
      });

      if (error) {
        throw new EmailProviderError({
          provider: 'resend',
          message: `Failed to send email: ${error.message}`,
        });
      }

      const id = data?.id ?? '';
      return { id, ids: [id] };
    },
  };
}
