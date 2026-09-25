import { db, type HaloOutboxEvent, type Prisma } from '@db';
import { HALO_OUTBOX_BATCH_SIZE, HALO_OUTBOX_STALE_PROCESSING_MS } from './halopsa.constants';

/** Candidates scanned per claim, so blocked links do not starve the batch. */
const SCAN_FACTOR = 4;

type Ordered = Pick<HaloOutboxEvent, 'id' | 'linkId' | 'createdAt'>;

function isOlder(a: Ordered, b: Ordered): boolean {
  const diff = a.createdAt.getTime() - b.createdAt.getTime();
  return diff !== 0 ? diff < 0 : a.id < b.id;
}

/**
 * The oldest queued (pending or processing) event per link. Only that event
 * may be sent: a newer note/status/reopen must never overtake an older
 * create for the same ticket, whether the older one is due, backing off or
 * currently being processed by another worker.
 */
async function oldestQueuedByLink(linkIds: string[]): Promise<Map<string, Ordered>> {
  const queued = await db.haloOutboxEvent.findMany({
    where: { linkId: { in: linkIds }, status: { in: ['pending', 'processing'] } },
    select: { id: true, linkId: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const oldest = new Map<string, Ordered>();
  for (const event of queued) {
    const current = oldest.get(event.linkId);
    if (!current || isOlder(event, current)) oldest.set(event.linkId, event);
  }
  return oldest;
}

/**
 * Claim due events, at most one per link and only the oldest queued one for
 * that link. A claim flips the row to `processing` with an optimistic guard
 * on (id, status, nextAttemptAt), so two workers can never both win the same
 * event. `processing` rows get a lease in nextAttemptAt; a crashed worker's
 * rows become claimable again once it expires.
 */
export async function claimOutboxBatch({
  now = new Date(),
  limit = HALO_OUTBOX_BATCH_SIZE,
}: { now?: Date; limit?: number } = {}): Promise<HaloOutboxEvent[]> {
  const candidates = await db.haloOutboxEvent.findMany({
    where: { status: { in: ['pending', 'processing'] }, nextAttemptAt: { lte: now } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit * SCAN_FACTOR,
  });
  if (candidates.length === 0) return [];

  const oldest = await oldestQueuedByLink([...new Set(candidates.map((c) => c.linkId))]);
  const leaseUntil = new Date(now.getTime() + HALO_OUTBOX_STALE_PROCESSING_MS);
  const claimed: HaloOutboxEvent[] = [];
  const claimedLinks = new Set<string>();

  for (const candidate of candidates) {
    if (claimed.length >= limit) break;
    if (claimedLinks.has(candidate.linkId)) continue;
    if (oldest.get(candidate.linkId)?.id !== candidate.id) continue;

    const result = await db.haloOutboxEvent.updateMany({
      where: { id: candidate.id, status: candidate.status, nextAttemptAt: candidate.nextAttemptAt },
      data: { status: 'processing', nextAttemptAt: leaseUntil },
    });
    if (result.count === 1) {
      claimed.push({ ...candidate, status: 'processing', nextAttemptAt: leaseUntil });
      claimedLinks.add(candidate.linkId);
    }
  }
  return claimed;
}

/**
 * Guarded final write for a claimed event: applies only while we still hold
 * the lease (status processing + our lease timestamp). An expired lease that
 * another worker re-claimed and finished can never be overwritten.
 */
export async function finishClaimedEvent({
  event,
  data,
}: {
  event: Pick<HaloOutboxEvent, 'id' | 'nextAttemptAt'>;
  data: Prisma.HaloOutboxEventUpdateManyMutationInput;
}): Promise<boolean> {
  const result = await db.haloOutboxEvent.updateMany({
    where: { id: event.id, status: 'processing', nextAttemptAt: event.nextAttemptAt },
    data,
  });
  return result.count === 1;
}
