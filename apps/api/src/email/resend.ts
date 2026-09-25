import { render } from '@react-email/render';
import {
  deliverEmail,
  getEmailTransport,
  resolveFromAddress,
  resolveReplyTo,
  resolveTestRecipient,
} from '@trycompai/email';
import * as React from 'react';

// File name kept for backwards compatibility: sends go through the
// provider-agnostic transport (Cloudflare Email Service or Resend).

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

  try {
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
        scheduledAt,
        attachments,
      },
    });

    return {
      message: 'Email sent successfully',
      id: result.id,
    };
  } catch (error) {
    console.error('Email sending error:', error);
    throw error instanceof Error ? error : new Error('Failed to send email');
  }
};
