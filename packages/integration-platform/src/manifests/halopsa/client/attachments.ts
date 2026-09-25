import type { HaloHttp } from './http';
import { idFromWriteResult } from './schemas';

/** Halo rejects very large uploads; keep attachments well under that. */
export const HALO_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export class HaloAttachmentTooLargeError extends Error {
  constructor(bytes: number) {
    super(`Attachment is ${bytes} bytes; the limit is ${HALO_MAX_ATTACHMENT_BYTES} bytes`);
    this.name = 'HaloAttachmentTooLargeError';
  }
}

export interface AttachToTicketInput {
  ticketId: number;
  filename: string;
  /** File content, base64 encoded (no data: prefix). */
  base64: string;
}

/** Decoded size of a base64 string, without decoding it. */
export function base64DecodedBytes(base64: string): number {
  const clean = base64.replace(/\s+/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

/**
 * `POST /Attachment` body. Field names (`ticket_id`, `filename`,
 * `data_base64`) are unconfirmed; see the README.
 */
export function buildAttachmentPayload(input: AttachToTicketInput): Array<Record<string, unknown>> {
  return [{ ticket_id: input.ticketId, filename: input.filename, data_base64: input.base64 }];
}

/** Attach a file to a ticket. Returns the attachment id. */
export async function attachToTicket({
  http,
  input,
}: {
  http: HaloHttp;
  input: AttachToTicketInput;
}): Promise<number> {
  const bytes = base64DecodedBytes(input.base64);
  if (bytes > HALO_MAX_ATTACHMENT_BYTES) throw new HaloAttachmentTooLargeError(bytes);
  const data = await http.post('/Attachment', buildAttachmentPayload(input));
  return idFromWriteResult(data);
}
