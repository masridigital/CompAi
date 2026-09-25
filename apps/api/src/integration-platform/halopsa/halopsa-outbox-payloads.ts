import { HaloApiError, HaloAuthError, HaloConfigError } from '@trycompai/integration-platform';
import { z } from 'zod';

const optionalId = z.number().int().positive().optional();

export const CreateTicketPayloadSchema = z.object({
  summary: z.string().min(1),
  details: z.string(),
  priorityId: optionalId,
  ticketTypeId: optionalId,
  teamId: optionalId,
  agentId: optionalId,
  resolvedStatusId: optionalId,
  /** The link's ref token may already be on a Halo ticket (earlier create died ambiguously). */
  searchFirst: z.boolean().optional(),
});
export type CreateTicketPayloadData = z.infer<typeof CreateTicketPayloadSchema>;

export const AddNotePayloadSchema = z.object({ note: z.string().min(1) });

export const SetStatusPayloadSchema = z.object({
  statusId: z.number().int().positive(),
  note: z.string().optional(),
  previousStatusId: optionalId,
  /** Wait until earlier events on the link are sent (e.g. attach before close). */
  afterPrior: z.boolean().optional(),
  /** Mark the link resolved once the status is set (report tickets). */
  markLinkResolved: z.boolean().optional(),
});

export const ReopenPayloadSchema = z.object({
  note: z.string().min(1),
  fallback: CreateTicketPayloadSchema,
});

/** An error that should not be retried (bad payload, unsupported kind, missing mapping). */
export class HaloPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HaloPermanentError';
  }
}

/** Retry later without spending an attempt (e.g. waiting for the ticket to be created). */
export class HaloDeferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HaloDeferError';
  }
}

export const AMBIGUOUS_PREFIX = 'ambiguous: ';

/**
 * True when a write may have reached Halo without us seeing the response:
 * network errors, timeouts, 5xx after retries, or an unparseable success body.
 * Errors raised before the request (auth/config) or definite 4xx rejections are not.
 */
export function isAmbiguousWriteError(error: unknown): boolean {
  if (error instanceof HaloAuthError || error instanceof HaloConfigError) return false;
  if (error instanceof HaloPermanentError || error instanceof HaloDeferError) return false;
  if (error instanceof HaloApiError) return error.status >= 500;
  return true;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
