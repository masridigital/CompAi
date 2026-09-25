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
 * handling as the webhook (plan 6.4, halopsa-reconcile-tickets).
 */
@Injectable()
export class HaloReconcileService {
  private readonly logger = new Logger(HaloReconcileService.name);

  async reconcile({ client }: { client: HaloClient }): Promise<ReconcileResult> {
    const links = await db.haloTicketLink.findMany({
      where: { state: 'open', haloTicketId: { not: null } },
      orderBy: { lastEventAt: 'asc' },
      take: RECONCILE_BATCH,
    });

    const result: ReconcileResult = { checked: 0, closed: 0, errors: 0 };
    for (const link of links) {
      if (link.haloTicketId === null) continue;
      result.checked++;
      try {
        const ticket = await client.getTicket(link.haloTicketId);
        const closed = ticket.hasbeenclosed === true || ticketClosedAt(ticket) !== null;
        if (!closed) continue;
        const outcome = await handleHaloTicketClosed({
          link,
          ticketId: link.haloTicketId,
          resolution: ticket.closure_note ?? ticket.resolution ?? null,
        });
        if (outcome !== 'already_closed') result.closed++;
      } catch (error) {
        if (error instanceof HaloApiError && error.status === 404) {
          await handleHaloTicketClosed({
            link,
            ticketId: link.haloTicketId,
            resolution: 'The ticket no longer exists in Halo.',
          });
          result.closed++;
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
