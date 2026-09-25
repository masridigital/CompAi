import { db, type HaloOutboxEvent, type HaloTicketLink, type IntegrationConnection } from '@db';
import { ticketClosedAt, type HaloClient } from '@trycompai/integration-platform';
import { resolveMappingForConnection } from './halopsa-connection';
import {
  AddNotePayloadSchema,
  AMBIGUOUS_PREFIX,
  CreateTicketPayloadSchema,
  HaloDeferError,
  HaloPermanentError,
  ReopenPayloadSchema,
  SetStatusPayloadSchema,
  type CreateTicketPayloadData,
} from './halopsa-outbox-payloads';
import {
  executeAttachFile,
  executePushCustomFields,
  waitForPriorEvents,
} from './halopsa-outbox-extra-handlers';

type LinkWithConnection = HaloTicketLink & { connection: IntegrationConnection };

export interface ExecuteContext {
  client: HaloClient;
  event: HaloOutboxEvent;
  link: LinkWithConnection;
}

async function mappingFor(link: LinkWithConnection) {
  const mapping = resolveMappingForConnection(link.connection);
  if (!mapping) {
    throw new HaloPermanentError(`Connection ${link.connectionId} has no valid Halo client mapping`);
  }
  return mapping;
}

function requireTicketId(link: HaloTicketLink): number {
  if (link.haloTicketId === null) {
    throw new HaloDeferError('Waiting for the Halo ticket to be created');
  }
  return link.haloTicketId;
}

/** Find a ticket we may already have created, by the ref token in its summary. */
async function findTicketByRefToken({
  client,
  clientId,
  refToken,
}: {
  client: HaloClient;
  clientId: number;
  refToken: string;
}): Promise<number | null> {
  const tickets = await client.searchTickets({ clientId, search: refToken, maxPages: 2 });
  const match = tickets.find((t) => (t.summary ?? '').includes(refToken));
  return match ? match.id : null;
}

/**
 * Create (or adopt) the ticket for a link. After an ambiguous failure the ref
 * token is searched first so a retry never creates a duplicate.
 */
async function createOrAdopt({
  ctx,
  payload,
  searchFirst,
}: {
  ctx: ExecuteContext;
  payload: CreateTicketPayloadData;
  searchFirst: boolean;
}): Promise<number> {
  const { client, link } = ctx;
  const mapping = await mappingFor(link);

  if (searchFirst) {
    const existing = await findTicketByRefToken({
      client,
      clientId: mapping.haloClientId,
      refToken: link.refToken,
    });
    if (existing !== null) return existing;
  }

  return client.createTicket({
    clientId: mapping.haloClientId,
    siteId: mapping.haloSiteId,
    summary: payload.summary,
    details: payload.details,
    ticketTypeId: payload.ticketTypeId,
    teamId: payload.teamId,
    agentId: payload.agentId,
    priorityId: payload.priorityId,
  });
}

function previousWasAmbiguous(event: HaloOutboxEvent): boolean {
  return (event.lastError ?? '').startsWith(AMBIGUOUS_PREFIX);
}

async function executeCreate(ctx: ExecuteContext): Promise<void> {
  const { link, client } = ctx;
  if (link.haloTicketId !== null && link.state !== 'pending_create') return;

  const payload = CreateTicketPayloadSchema.parse(ctx.event.payload);
  const ticketId = await createOrAdopt({ ctx, payload, searchFirst: previousWasAmbiguous(ctx.event) });

  const current = await db.haloTicketLink.findUnique({ where: { id: link.id }, select: { state: true } });
  const resolvedMeanwhile = current?.state === 'resolved';
  await db.haloTicketLink.update({
    where: { id: link.id },
    data: {
      haloTicketId: ticketId,
      ...(current?.state === 'pending_create' ? { state: 'open' as const } : {}),
    },
  });

  // The issue was fixed while the create was in flight: resolve right away.
  if (resolvedMeanwhile && payload.resolvedStatusId) {
    await client.addAction({ ticketId, note: '<p>Resolved in CompAI before this ticket was raised.</p>' });
    await client.setStatus({ ticketId, statusId: payload.resolvedStatusId });
  }
}

async function executeSetStatus(ctx: ExecuteContext): Promise<void> {
  const ticketId = requireTicketId(ctx.link);
  const payload = SetStatusPayloadSchema.parse(ctx.event.payload);
  if (payload.afterPrior) await waitForPriorEvents(ctx.event);

  // Remember the status before resolving so a regression can restore it.
  if (payload.previousStatusId === undefined) {
    const ticket = await ctx.client.getTicket(ticketId);
    if (ticket.status_id) {
      await db.haloOutboxEvent.update({
        where: { id: ctx.event.id },
        data: { payload: { ...payload, previousStatusId: ticket.status_id } },
      });
    }
  }
  if (payload.note) await ctx.client.addAction({ ticketId, note: payload.note });
  await ctx.client.setStatus({ ticketId, statusId: payload.statusId });
  if (payload.markLinkResolved) {
    await db.haloTicketLink.updateMany({
      where: { id: ctx.link.id, state: 'open' },
      data: { state: 'resolved', resolvedAt: new Date() },
    });
  }
}

async function lastResolvedFromStatus(linkId: string): Promise<number | null> {
  const events = await db.haloOutboxEvent.findMany({
    where: { linkId, kind: 'set_status', status: 'done' },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  for (const event of events) {
    const parsed = SetStatusPayloadSchema.safeParse(event.payload);
    if (parsed.success && parsed.data.previousStatusId) return parsed.data.previousStatusId;
  }
  return null;
}

async function executeReopen(ctx: ExecuteContext): Promise<void> {
  const { client, link } = ctx;
  const payload = ReopenPayloadSchema.parse(ctx.event.payload);
  const ticketId = requireTicketId(link);

  const previousStatusId = await lastResolvedFromStatus(link.id);
  if (previousStatusId !== null) {
    await client.setStatus({ ticketId, statusId: previousStatusId });
    await client.addAction({ ticketId, note: payload.note });
    return;
  }

  // No status to restore: note the ticket if it is still open, else raise a new one.
  const ticket = await client.getTicket(ticketId);
  const closed = ticket.hasbeenclosed === true || ticketClosedAt(ticket) !== null;
  if (!closed) {
    await client.addAction({ ticketId, note: payload.note });
    return;
  }
  const newId = await createOrAdopt({ ctx, payload: payload.fallback, searchFirst: true });
  if (newId === ticketId) {
    await client.addAction({ ticketId, note: payload.note });
    return;
  }
  await db.haloTicketLink.update({ where: { id: link.id }, data: { haloTicketId: newId, state: 'open' } });
}

async function executeAddNote(ctx: ExecuteContext): Promise<void> {
  const ticketId = requireTicketId(ctx.link);
  const payload = AddNotePayloadSchema.parse(ctx.event.payload);
  await ctx.client.addAction({ ticketId, note: payload.note });
}

/** Execute one outbox event against Halo. Throws on failure. */
export async function executeOutboxEvent(ctx: ExecuteContext): Promise<void> {
  switch (ctx.event.kind) {
    case 'create_ticket':
      return executeCreate(ctx);
    case 'add_note':
      return executeAddNote(ctx);
    case 'set_status':
      return executeSetStatus(ctx);
    case 'reopen':
      return executeReopen(ctx);
    case 'push_custom_fields':
      return executePushCustomFields(ctx);
    case 'attach_file':
      return executeAttachFile(ctx);
    default:
      throw new HaloPermanentError(`Unsupported outbox event kind: ${ctx.event.kind}`);
  }
}
