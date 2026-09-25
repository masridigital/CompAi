import { z } from 'zod';

/**
 * Halo's webhook body shape is not confirmed for this tenant (Standard
 * Webhook, JSON). Parse defensively: accept `id`, `ticket_id` or `ticket.id`
 * and several closed signals, keep unknown keys.
 */
const idLike = z.union([z.number(), z.string().regex(/^\d+$/)]).transform(Number);
const loose = z.looseObject({});

const WebhookBodySchema = z.looseObject({
  id: idLike.optional().catch(undefined),
  ticket_id: idLike.optional().catch(undefined),
  ticket: loose.optional().catch(undefined),
});

export interface ParsedHaloWebhook {
  ticketId: number | null;
  /** true/false when the payload says so, null when it does not tell. */
  closed: boolean | null;
  resolution: string | null;
  agentName: string | null;
}

const CLOSED_WORDS = /\b(closed|resolved|completed|cancelled)\b/i;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function pick(sources: Array<Record<string, unknown>>, keys: string[]): unknown {
  for (const source of sources) {
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) return source[key];
    }
  }
  return undefined;
}

function isRealDate(value: unknown): boolean {
  const text = str(value);
  if (!text) return false;
  const date = new Date(text);
  return !Number.isNaN(date.getTime()) && date.getUTCFullYear() > 1971;
}

function positiveId(value: unknown): number | null {
  const parsed = idLike.safeParse(value);
  return parsed.success && Number.isInteger(parsed.data) && parsed.data > 0 ? parsed.data : null;
}

function detectClosed(sources: Array<Record<string, unknown>>): boolean | null {
  const flag = pick(sources, ['hasbeenclosed', 'closed', 'is_closed']);
  if (typeof flag === 'boolean') return flag;
  if (isRealDate(pick(sources, ['dateclosed', 'datecleared']))) return true;
  const label = [
    str(pick(sources, ['status_name', 'status'])),
    str(pick(sources, ['event', 'event_name', 'webhook_event'])),
  ]
    .filter(Boolean)
    .join(' ');
  return label && CLOSED_WORDS.test(label) ? true : null;
}

export function parseHaloWebhookBody(body: unknown): ParsedHaloWebhook {
  const parsed = WebhookBodySchema.safeParse(body ?? {});
  const root: Record<string, unknown> = parsed.success ? parsed.data : {};
  const ticket: Record<string, unknown> =
    parsed.success && parsed.data.ticket ? parsed.data.ticket : {};
  const sources = [ticket, root];

  const ticketId =
    positiveId(ticket.id) ??
    (parsed.success ? (parsed.data.ticket_id ?? null) : null) ??
    (parsed.success ? (parsed.data.id ?? null) : null);

  return {
    ticketId: ticketId && ticketId > 0 ? ticketId : null,
    closed: detectClosed(sources),
    resolution: str(pick(sources, ['closure_note', 'resolution', 'resolution_note', 'note'])),
    agentName: str(pick(sources, ['agent_name', 'closed_by', 'agent'])),
  };
}
