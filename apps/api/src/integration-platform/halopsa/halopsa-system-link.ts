import type { Prisma } from '@db';
import { generateRefToken } from './halopsa-ref-token';

/**
 * Outbox events always belong to a HaloTicketLink. Writes that are not about
 * a ticket (client custom-field pushes) hang off a per-org "system" link with
 * no Halo ticket, e.g. entityType 'posture' / dedupKey 'posture'. It is
 * `open` with haloTicketId null, so reconcile and webhooks never match it.
 */
export async function ensureSystemLink({
  tx,
  organizationId,
  connectionId,
  entityType,
  dedupKey,
  now = new Date(),
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  connectionId: string;
  entityType: string;
  dedupKey: string;
  now?: Date;
}): Promise<{ id: string }> {
  return tx.haloTicketLink.upsert({
    where: { organizationId_dedupKey: { organizationId, dedupKey } },
    create: {
      organizationId,
      connectionId,
      entityType,
      entityId: organizationId,
      dedupKey,
      refToken: generateRefToken(),
      state: 'open',
      lastEventAt: now,
    },
    update: { connectionId, lastEventAt: now },
    select: { id: true },
  });
}
