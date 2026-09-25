import { attachmentToBase64, toList, type EmailMessage } from './types';

/** Cloudflare accepts at most 50 recipients (to + cc + bcc) per message. */
export const CLOUDFLARE_MAX_RECIPIENTS = 50;

/**
 * Cloudflare's hard limit is 5 MiB per message including attachments. We stop at
 * 4.5 MiB to leave room for MIME encoding overhead and headers added by Cloudflare.
 */
export const CLOUDFLARE_MAX_MESSAGE_BYTES = 4.5 * 1024 * 1024;

export interface RecipientChunk {
  to: string[];
  cc: string[];
  bcc: string[];
}

type RecipientKind = keyof RecipientChunk;

/**
 * Splits to/cc/bcc into chunks of at most `limit` total recipients, preserving
 * each address's role. Most sends have a single recipient and yield one chunk.
 */
export function chunkRecipients(params: {
  to: EmailMessage['to'];
  cc?: EmailMessage['cc'];
  bcc?: EmailMessage['bcc'];
  limit?: number;
}): RecipientChunk[] {
  const limit = params.limit ?? CLOUDFLARE_MAX_RECIPIENTS;
  const all: Array<{ kind: RecipientKind; address: string }> = [
    ...toList(params.to).map((address) => ({ kind: 'to' as const, address })),
    ...toList(params.cc).map((address) => ({ kind: 'cc' as const, address })),
    ...toList(params.bcc).map((address) => ({ kind: 'bcc' as const, address })),
  ];

  const chunks: RecipientChunk[] = [];
  for (let i = 0; i < all.length; i += limit) {
    const chunk: RecipientChunk = { to: [], cc: [], bcc: [] };
    for (const recipient of all.slice(i, i + limit)) {
      chunk[recipient.kind].push(recipient.address);
    }
    chunks.push(chunk);
  }
  return chunks;
}

/** Approximate encoded size of the message body we send (attachments counted as base64). */
export function estimateMessageBytes(message: EmailMessage): number {
  const textParts = [message.subject, message.html, message.text];
  const headerBytes = Object.entries(message.headers ?? {}).reduce(
    (sum, [key, value]) => sum + Buffer.byteLength(key) + Buffer.byteLength(value),
    0,
  );
  const attachmentBytes = (message.attachments ?? []).reduce(
    (sum, att) => sum + Buffer.byteLength(attachmentToBase64(att.content)),
    0,
  );
  const bodyBytes = textParts.reduce((sum, part) => sum + Buffer.byteLength(part ?? ''), 0);
  return bodyBytes + headerBytes + attachmentBytes;
}

/** Parses a Retry-After header (delta-seconds or HTTP date) into milliseconds. */
export function parseRetryAfterMs(params: {
  header: string | null;
  now?: number;
}): number | undefined {
  if (!params.header) return undefined;
  const seconds = Number(params.header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(params.header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - (params.now ?? Date.now()));
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Exponential backoff (500ms, 1s, 2s, ...) with Retry-After taking precedence, capped. */
export function computeBackoffMs(params: {
  attempt: number;
  retryAfterMs?: number;
  baseMs?: number;
  maxMs?: number;
}): number {
  const maxMs = params.maxMs ?? 30_000;
  if (params.retryAfterMs !== undefined) return Math.min(params.retryAfterMs, maxMs);
  const baseMs = params.baseMs ?? 500;
  return Math.min(baseMs * 2 ** (params.attempt - 1), maxMs);
}
