import { z } from 'zod';
import {
  CLOUDFLARE_MAX_MESSAGE_BYTES,
  chunkRecipients,
  computeBackoffMs,
  estimateMessageBytes,
  isRetryableStatus,
  parseRetryAfterMs,
  type RecipientChunk,
} from './cloudflare-utils';
import {
  EmailConfigurationError,
  EmailProviderError,
  EmailValidationError,
  attachmentToBase64,
  type EmailMessage,
  type EmailSendResult,
  type EmailTransport,
} from './types';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';
const MAX_ATTEMPTS = 3;

const cloudflareEnvelopeSchema = z.object({
  success: z.boolean(),
  errors: z
    .array(z.object({ code: z.number().optional(), message: z.string() }).passthrough())
    .default([]),
  result: z
    .object({
      message_id: z.string().optional(),
      delivered: z.array(z.string()).default([]),
      permanent_bounces: z.array(z.string()).default([]),
      queued: z.array(z.string()).default([]),
    })
    .passthrough()
    .nullish(),
});

type CloudflareEnvelope = z.infer<typeof cloudflareEnvelopeSchema>;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface CloudflareTransportOptions {
  accountId: string;
  apiToken: string;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Builds the JSON body for one recipient chunk. Field names follow the Cloudflare REST schema. */
export function buildCloudflarePayload(params: {
  message: EmailMessage;
  recipients: RecipientChunk;
}): Record<string, unknown> {
  const { message, recipients } = params;
  const payload: Record<string, unknown> = {
    from: message.from,
    subject: message.subject,
    html: message.html,
    text: message.text,
  };
  if (recipients.to.length > 0) payload.to = recipients.to;
  if (recipients.cc.length > 0) payload.cc = recipients.cc;
  if (recipients.bcc.length > 0) payload.bcc = recipients.bcc;
  if (message.replyTo) payload.reply_to = message.replyTo;
  if (message.headers && Object.keys(message.headers).length > 0) {
    payload.headers = message.headers;
  }
  if (message.attachments && message.attachments.length > 0) {
    payload.attachments = message.attachments.map((att) => ({
      content: attachmentToBase64(att.content),
      filename: att.filename,
      type: att.contentType ?? 'application/octet-stream',
      disposition: 'attachment',
    }));
  }
  return payload;
}

function describeErrors(envelope: CloudflareEnvelope | undefined): string {
  if (!envelope || envelope.errors.length === 0) return 'unknown error';
  return envelope.errors
    .map((err) => (err.code !== undefined ? `${err.code}: ${err.message}` : err.message))
    .join('; ');
}

async function readEnvelope(response: Response): Promise<CloudflareEnvelope | undefined> {
  const raw: unknown = await response.json().catch(() => undefined);
  const parsed = cloudflareEnvelopeSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function validateForCloudflare(message: EmailMessage): void {
  if (message.scheduledAt && Date.parse(message.scheduledAt) > Date.now()) {
    throw new EmailValidationError(
      'Cloudflare Email Service does not support scheduledAt. Schedule the send with Trigger.dev (triggerEmail) instead.',
    );
  }
  const bytes = estimateMessageBytes(message);
  if (bytes > CLOUDFLARE_MAX_MESSAGE_BYTES) {
    const mib = (bytes / (1024 * 1024)).toFixed(2);
    throw new EmailValidationError(
      `Email is ${mib} MiB, over the 4.5 MiB limit (including attachments). Link to the file in the app instead of attaching it.`,
    );
  }
}

export function createCloudflareTransport(options: CloudflareTransportOptions): EmailTransport {
  if (!options.accountId) throw new EmailConfigurationError('CLOUDFLARE_ACCOUNT_ID is not set');
  if (!options.apiToken) {
    throw new EmailConfigurationError('CLOUDFLARE_EMAIL_API_TOKEN is not set');
  }

  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const url = `${CLOUDFLARE_API_BASE}/accounts/${encodeURIComponent(options.accountId)}/email/sending/send`;

  const postOnce = async (payload: Record<string, unknown>): Promise<string> => {
    let lastError: EmailProviderError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        lastError = new EmailProviderError({
          provider: 'cloudflare',
          message: `Cloudflare email request failed: ${error instanceof Error ? error.message : String(error)}`,
          retryable: true,
        });
        if (attempt < maxAttempts) await sleep(computeBackoffMs({ attempt }));
        continue;
      }

      const envelope = await readEnvelope(response);

      if (response.ok && envelope?.success) {
        const result = envelope.result;
        const accepted = (result?.delivered.length ?? 0) + (result?.queued.length ?? 0);
        if (result && accepted === 0 && result.permanent_bounces.length > 0) {
          throw new EmailProviderError({
            provider: 'cloudflare',
            message: `Cloudflare reported permanent bounce for all ${result.permanent_bounces.length} recipient(s)`,
            status: response.status,
          });
        }
        return result?.message_id ?? '';
      }

      const retryable = isRetryableStatus(response.status);
      lastError = new EmailProviderError({
        provider: 'cloudflare',
        message: `Cloudflare email send failed (HTTP ${response.status}): ${describeErrors(envelope)}`,
        status: response.status,
        retryable,
      });
      if (!retryable) throw lastError;
      if (attempt < maxAttempts) {
        const retryAfterMs = parseRetryAfterMs({ header: response.headers.get('retry-after') });
        await sleep(computeBackoffMs({ attempt, retryAfterMs }));
      }
    }

    throw (
      lastError ??
      new EmailProviderError({ provider: 'cloudflare', message: 'Cloudflare email send failed' })
    );
  };

  return {
    provider: 'cloudflare',
    async send(message: EmailMessage): Promise<EmailSendResult> {
      validateForCloudflare(message);
      const chunks = chunkRecipients({ to: message.to, cc: message.cc, bcc: message.bcc });
      if (chunks.length === 0) throw new EmailValidationError('Email has no recipients');

      const ids: string[] = [];
      for (const recipients of chunks) {
        ids.push(await postOnce(buildCloudflarePayload({ message, recipients })));
      }
      return { id: ids[0] ?? '', ids };
    },
  };
}
