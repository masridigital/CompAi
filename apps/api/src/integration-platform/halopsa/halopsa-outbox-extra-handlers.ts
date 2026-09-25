import { db, type HaloOutboxEvent, type HaloTicketLink, type IntegrationConnection } from '@db';
import { HaloAttachmentTooLargeError, type HaloClient } from '@trycompai/integration-platform';
import { z } from 'zod';
import { resolveMappingForConnection } from './halopsa-connection';
import { HaloDeferError, HaloPermanentError } from './halopsa-outbox-payloads';

interface ExtraContext {
  client: HaloClient;
  event: HaloOutboxEvent;
  link: HaloTicketLink & { connection: IntegrationConnection };
}

export const PushCustomFieldsPayloadSchema = z.object({
  fields: z.record(z.string(), z.union([z.string(), z.number()])),
});

export const AttachFilePayloadSchema = z.object({
  filename: z.string().min(1).max(200),
  base64: z.string().min(1),
});

/** Defer while an older event for the same link is still queued (keeps create -> attach -> close order). */
export async function waitForPriorEvents(event: HaloOutboxEvent): Promise<void> {
  const prior = await db.haloOutboxEvent.count({
    where: {
      linkId: event.linkId,
      id: { not: event.id },
      status: { in: ['pending', 'processing'] },
      createdAt: { lt: event.createdAt },
    },
  });
  if (prior > 0) throw new HaloDeferError('Waiting for earlier events on this ticket');
}

/** Plan 5.3: write the CFCompAI* client custom fields. Idempotent. */
export async function executePushCustomFields(ctx: ExtraContext): Promise<void> {
  const payload = PushCustomFieldsPayloadSchema.parse(ctx.event.payload);
  const mapping = resolveMappingForConnection(ctx.link.connection);
  if (!mapping) {
    throw new HaloPermanentError(`Connection ${ctx.link.connectionId} has no valid Halo client mapping`);
  }
  await ctx.client.updateClientCustomFields({ clientId: mapping.haloClientId, fields: payload.fields });
}

/** Attach a file (e.g. the monthly posture PDF) to the link's ticket. */
export async function executeAttachFile(ctx: ExtraContext): Promise<void> {
  if (ctx.link.haloTicketId === null) throw new HaloDeferError('Waiting for the Halo ticket to be created');
  await waitForPriorEvents(ctx.event);
  const payload = AttachFilePayloadSchema.parse(ctx.event.payload);
  try {
    await ctx.client.attachToTicket({
      ticketId: ctx.link.haloTicketId,
      filename: payload.filename,
      base64: payload.base64,
    });
  } catch (error) {
    if (error instanceof HaloAttachmentTooLargeError) throw new HaloPermanentError(error.message);
    throw error;
  }
}
