export type EmailProvider = 'cloudflare' | 'resend';

export interface EmailTransportAttachment {
  filename: string;
  /** Raw bytes, or a base64-encoded string. */
  content: Buffer | string;
  contentType?: string;
}

export interface EmailMessage {
  from: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailTransportAttachment[];
  headers?: Record<string, string>;
  /**
   * ISO timestamp for deferred delivery. Only the Resend transport supports it;
   * the Cloudflare transport rejects a future value (schedule with Trigger.dev instead).
   */
  scheduledAt?: string;
}

export interface EmailSendResult {
  /** Provider message id. When a message was split into chunks, the first chunk's id. */
  id: string;
  /** Every provider message id, one per chunk sent. */
  ids: string[];
}

export interface EmailTransport {
  readonly provider: EmailProvider;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export class EmailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailConfigurationError';
  }
}

export class EmailValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailValidationError';
  }
}

export class EmailProviderError extends Error {
  readonly provider: EmailProvider;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(params: {
    provider: EmailProvider;
    message: string;
    status?: number;
    retryable?: boolean;
  }) {
    super(params.message);
    this.name = 'EmailProviderError';
    this.provider = params.provider;
    this.status = params.status;
    this.retryable = params.retryable ?? false;
  }
}

/** Normalizes a recipient field to a list. Strings are kept whole (display names may contain commas). */
export function toList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => item.trim()).filter((item) => item.length > 0);
}

export function attachmentToBase64(content: Buffer | string): string {
  return typeof content === 'string' ? content : content.toString('base64');
}
