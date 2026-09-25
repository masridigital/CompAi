import { db, Prisma } from '@db';
import type { HaloAlertSettings, HaloAlertTrigger } from '@trycompai/integration-platform';
import { decideAlertAction, type AlertDecision } from './halopsa-alert-state';
import { generateRefToken } from './halopsa-ref-token';
import { buildNote, type TicketContent } from './halopsa-ticket-content';
import type { HaloEntityType, HaloOutboxKind } from './halopsa.constants';

type Tx = Prisma.TransactionClient;

export interface CreateTicketPayload {
  summary: string;
  details: string;
  priorityId?: number;
  ticketTypeId?: number;
  teamId?: number;
  agentId?: number;
  /** Status applied if the link was resolved while the create was in flight. */
  resolvedStatusId?: number;
  /** Search Halo for the ref token before creating (the token may already be on a ticket). */
  searchFirst?: boolean;
}

export interface AlertSignal {
  organizationId: string;
  connectionId: string;
  settings: HaloAlertSettings;
  trigger: HaloAlertTrigger;
  entityType: HaloEntityType;
  entityId: string;
  dedupKey: string;
  /** Earlier dedupKey format for the same entity; such a link is adopted (renamed). */
  legacyDedupKey?: string;
  failing: boolean;
  priorityId: number;
  buildTicket: (refToken: string) => Promise<TicketContent>;
  repeatNote: string;
  resolveNote: string;
  reopenNote: string;
  now?: Date;
}

export interface AlertOutcome {
  decision: AlertDecision;
  enqueued: HaloOutboxKind[];
}

const QUEUED_STATUSES = ['pending', 'processing'] as const;

async function enqueue({
  tx,
  organizationId,
  linkId,
  kind,
  payload,
  now,
}: {
  tx: Tx;
  organizationId: string;
  linkId: string;
  kind: HaloOutboxKind;
  payload: Prisma.InputJsonObject;
  now: Date;
}): Promise<void> {
  await tx.haloOutboxEvent.create({
    data: { organizationId, linkId, kind, payload, status: 'pending', nextAttemptAt: now },
  });
}

function createPayload({
  signal,
  content,
}: {
  signal: AlertSignal;
  content: TicketContent;
}): CreateTicketPayload {
  const { settings } = signal;
  return {
    summary: content.summary,
    details: content.details,
    priorityId: signal.priorityId,
    ticketTypeId: settings.ticketTypeId,
    teamId: settings.teamId,
    agentId: settings.agentId,
    resolvedStatusId: settings.resolvedStatusId,
  };
}

function toJson(payload: CreateTicketPayload): Prisma.InputJsonObject {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/** The link for this signal, adopting one stored under the legacy dedupKey. */
async function findLink({ tx, signal }: { tx: Tx; signal: AlertSignal }) {
  const { organizationId, dedupKey, legacyDedupKey } = signal;
  const link = await tx.haloTicketLink.findUnique({
    where: { organizationId_dedupKey: { organizationId, dedupKey } },
  });
  if (link || !legacyDedupKey) return link;

  const legacy = await tx.haloTicketLink.findUnique({
    where: { organizationId_dedupKey: { organizationId, dedupKey: legacyDedupKey } },
  });
  if (!legacy) return null;
  // Guarded rename: only one signal can adopt a legacy link.
  const renamed = await tx.haloTicketLink.updateMany({
    where: { id: legacy.id, dedupKey: legacyDedupKey },
    data: { dedupKey },
  });
  return renamed.count === 1 ? { ...legacy, dedupKey } : null;
}

/**
 * Apply one alert signal: upsert the HaloTicketLink by dedupKey and write the
 * resulting outbox events, all in one transaction. Two concurrent signals for
 * a new dedupKey race on the unique index; the loser (P2002) retries once and
 * then sees the winner's link.
 */
export async function applyAlertSignal(signal: AlertSignal): Promise<AlertOutcome> {
  try {
    return await applyAlertSignalOnce(signal);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return applyAlertSignalOnce(signal);
  }
}

async function applyAlertSignalOnce(signal: AlertSignal): Promise<AlertOutcome> {
  const now = signal.now ?? new Date();
  const { organizationId, dedupKey } = signal;

  return db.$transaction(async (tx) => {
    const link = await findLink({ tx, signal });
    const queued = link
      ? await tx.haloOutboxEvent.count({
          where: { linkId: link.id, status: { in: [...QUEUED_STATUSES] } },
        })
      : 0;

    const decision = decideAlertAction({ link, failing: signal.failing, hasQueuedEvent: queued > 0, now });
    const enqueued: HaloOutboxKind[] = [];
    const add = async (linkId: string, kind: HaloOutboxKind, payload: Prisma.InputJsonObject) => {
      await enqueue({ tx, organizationId, linkId, kind, payload, now });
      enqueued.push(kind);
    };

    switch (decision) {
      case 'create': {
        // A link still pending_create had a create that died after an
        // ambiguous failure: its ticket may exist in Halo, so keep the token
        // and search for it before creating. Otherwise a fresh ticket gets a
        // fresh reference token.
        const reuse = link?.state === 'pending_create';
        const refToken = reuse ? link.refToken : generateRefToken();
        const content = await signal.buildTicket(refToken);
        const data = {
          connectionId: signal.connectionId,
          entityType: signal.entityType,
          entityId: signal.entityId,
          refToken,
          haloTicketId: null,
          state: 'pending_create' as const,
          resolvedAt: null,
          lastEventAt: now,
        };
        const saved = link
          ? await tx.haloTicketLink.update({ where: { id: link.id }, data })
          : await tx.haloTicketLink.create({ data: { ...data, organizationId, dedupKey } });
        const payload = createPayload({ signal, content });
        await add(saved.id, 'create_ticket', toJson(reuse ? { ...payload, searchFirst: true } : payload));
        break;
      }
      case 'note': {
        if (!link) break;
        await tx.haloTicketLink.update({
          where: { id: link.id },
          data: { lastEventAt: now, entityId: signal.entityId },
        });
        await add(link.id, 'add_note', { note: buildNote([signal.repeatNote]) });
        break;
      }
      case 'reopen': {
        if (!link) break;
        const content = await signal.buildTicket(link.refToken);
        await tx.haloTicketLink.update({
          where: { id: link.id },
          data: { state: 'open', resolvedAt: null, lastEventAt: now, entityId: signal.entityId },
        });
        await add(link.id, 'reopen', {
          note: buildNote([signal.reopenNote]),
          fallback: toJson(createPayload({ signal, content })),
        });
        break;
      }
      case 'resolve': {
        if (!link) break;
        await tx.haloTicketLink.update({
          where: { id: link.id },
          data: { state: 'resolved', resolvedAt: now, lastEventAt: now },
        });
        const note = buildNote([signal.resolveNote]);
        const statusId = signal.settings.resolvedStatusId;
        if (statusId) await add(link.id, 'set_status', { note, statusId });
        else await add(link.id, 'add_note', { note });
        break;
      }
      case 'cancel': {
        if (!link) break;
        await tx.haloOutboxEvent.updateMany({
          where: { linkId: link.id, status: 'pending', kind: 'create_ticket' },
          data: { status: 'done', lastError: 'cancelled: resolved before the ticket was sent' },
        });
        await tx.haloTicketLink.update({
          where: { id: link.id },
          data: { state: 'resolved', resolvedAt: now, lastEventAt: now },
        });
        break;
      }
      case 'none':
        break;
    }

    return { decision, enqueued };
  });
}
