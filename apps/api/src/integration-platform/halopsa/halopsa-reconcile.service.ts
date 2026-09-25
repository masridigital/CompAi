import { Injectable, Logger } from '@nestjs/common';
import { db } from '@db';
import { HaloApiError, ticketClosedAt, type HaloClient } from '@trycompai/integration-platform';
import { handleHaloTicketClosed } from './halopsa-closed-handler';

const RECONCILE_BATCH = 500;

export interface ReconcileResult {
  checked: number;
  closed: number;
  errors: number;
}

/**
 * Webhooks are best effort: poll open links and apply the same closed
 * handling as the webhook (plan 6.4, halopsa-reconcile-tickets). Each run
 * takes the least recently reconciled open links (never-polled first) and
 * stamps lastReconciledAt, so more than one batch of open links is covered
 * over successive runs.
 */
@Injectable()
export class HaloReconcileService {
  private readonly logger = new Logger(HaloReconcileService.name);

  async reconcile({
    client,
    now = new Date(),
    batchSize = RECONCILE_BATCH,
  }: {
    client: HaloClient;
    now?: Date;
    batchSize?: number;
  }): Promise<ReconcileResult> {
    const links = await db.haloTicketLink.findMany({
      where: { state: 'open', haloTicketId: { not: null } },
      orderBy: [{ lastReconciledAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: batchSize,
    });

    const result: ReconcileResult = { checked: 0, closed: 0, errors: 0 };
    for (const link of links) {
      if (link.haloTicketId === null) continue;
      result.checked++;
      // Advance the cursor first so a link that keeps failing cannot pin the batch.
      await db.haloTicketLink.update({ where: { id: link.id }, data: { lastReconciledAt: now } });
      try {
        const ticket = await client.getTicket(link.haloTicketId);
        const closed = ticket.hasbeenclosed === true || ticketClosedAt(ticket) !== null;
        if (!closed) continue;
        const outcome = await handleHaloTicketClosed({
          link,
          ticketId: link.haloTicketId,
          resolution: ticket.closure_note ?? ticket.resolution ?? null,
        });
        if (outcome !== 'already_closed' && outcome !== 'not_open') result.closed++;
      } catch (error) {
        if (error instanceof HaloApiError && error.status === 404) {
          const outcome = await handleHaloTicketClosed({
            link,
            ticketId: link.haloTicketId,
            resolution: 'The ticket no longer exists in Halo.',
          });
          if (outcome !== 'already_closed' && outcome !== 'not_open') result.closed++;
          continue;
        }
        result.errors++;
        this.logger.warn(
          `Reconcile failed for link ${link.id} (ticket ${link.haloTicketId}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return result;
  }
}
