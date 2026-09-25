import type { HaloTicketLinkState } from '@db';
import { HALO_REOPEN_WINDOW_MS } from './halopsa.constants';

/**
 * Pure dedupe / regression state machine (plan 5.2).
 *
 * failing:
 *   no link                          -> create
 *   pending_create, send in flight   -> none (the queued create covers it)
 *   pending_create, nothing queued   -> create (previous attempt died)
 *   open                             -> note (repeat failure)
 *   resolved / closed_externally
 *     within 7 days of resolvedAt    -> reopen the same ticket
 *     after 7 days (or no ticket)    -> create a new ticket
 *
 * passing:
 *   open                             -> resolve (note + resolved status)
 *   pending_create, send queued      -> cancel (drop the unsent create)
 *   anything else                    -> none
 */
export type AlertDecision = 'none' | 'create' | 'note' | 'reopen' | 'resolve' | 'cancel';

export interface LinkSnapshot {
  state: HaloTicketLinkState;
  haloTicketId: number | null;
  resolvedAt: Date | null;
}

export function decideAlertAction({
  link,
  failing,
  hasQueuedEvent,
  now,
}: {
  link: LinkSnapshot | null;
  failing: boolean;
  /** A pending/processing outbox event exists for this link. */
  hasQueuedEvent: boolean;
  now: Date;
}): AlertDecision {
  if (!failing) {
    if (!link) return 'none';
    if (link.state === 'open') return 'resolve';
    if (link.state === 'pending_create' && hasQueuedEvent) return 'cancel';
    return 'none';
  }

  if (!link) return 'create';

  switch (link.state) {
    case 'pending_create':
      return hasQueuedEvent ? 'none' : 'create';
    case 'open':
      return 'note';
    case 'resolved':
    case 'closed_externally': {
      if (link.haloTicketId === null) return 'create';
      const resolvedAt = link.resolvedAt?.getTime();
      if (resolvedAt !== undefined && now.getTime() - resolvedAt <= HALO_REOPEN_WINDOW_MS) {
        return 'reopen';
      }
      return 'create';
    }
    default:
      return 'none';
  }
}
