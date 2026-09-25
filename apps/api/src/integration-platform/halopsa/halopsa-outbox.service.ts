import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { db, type HaloOutboxEvent, type HaloOutboxStatus } from '@db';
import { createHaloClient, type HaloClient } from '@trycompai/integration-platform';
import { claimOutboxBatch, finishClaimedEvent } from './halopsa-outbox-claim';
import { executeOutboxEvent } from './halopsa-outbox-executor';
import {
  AMBIGUOUS_PREFIX,
  errorMessage,
  HaloDeferError,
  HaloPermanentError,
  isAmbiguousWriteError,
} from './halopsa-outbox-payloads';
import { redactSecrets } from '../utils/redact-secrets';
import {
  HALO_OUTBOX_BACKOFF_MS,
  HALO_OUTBOX_BATCH_SIZE,
  HALO_OUTBOX_MAX_ATTEMPTS,
  isOutboxPaused,
} from './halopsa.constants';

const DEFER_DELAY_MS = 30_000;
const WRITE_KINDS = new Set(['create_ticket', 'reopen']);

export interface DrainResult {
  paused: boolean;
  claimed: number;
  done: number;
  retried: number;
  dead: number;
  deferred: number;
  /** Our lease expired and another worker took the event; our outcome was dropped. */
  lost: number;
}

type EventOutcome = 'done' | 'retried' | 'dead' | 'deferred' | 'lost';

/** Delay before the next attempt, after `attempts` failures (1-based). */
export function backoffDelayMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), HALO_OUTBOX_BACKOFF_MS.length) - 1;
  return HALO_OUTBOX_BACKOFF_MS[index];
}

/**
 * Drains the HaloPSA outbox (plan 6.4). DI-free so the Trigger.dev task can
 * use `new HaloOutboxService()`.
 */
@Injectable()
export class HaloOutboxService {
  private readonly logger = new Logger(HaloOutboxService.name);

  /** Claim due events: one per link, oldest queued first (see claimOutboxBatch). */
  async claimBatch({
    now = new Date(),
    limit = HALO_OUTBOX_BATCH_SIZE,
  }: { now?: Date; limit?: number } = {}): Promise<HaloOutboxEvent[]> {
    return claimOutboxBatch({ now, limit });
  }

  async drain({
    now = new Date(),
    client,
  }: { now?: Date; client?: HaloClient } = {}): Promise<DrainResult> {
    const result: DrainResult = {
      paused: false,
      claimed: 0,
      done: 0,
      retried: 0,
      dead: 0,
      deferred: 0,
      lost: 0,
    };
    if (isOutboxPaused()) {
      this.logger.log('HALOPSA_OUTBOX_PAUSED=true: leaving events pending');
      return { ...result, paused: true };
    }

    const events = await this.claimBatch({ now });
    result.claimed = events.length;
    if (events.length === 0) return result;

    const halo = client ?? createHaloClient();
    for (const event of events) {
      const outcome = await this.processEvent({ event, client: halo, now });
      result[outcome]++;
    }
    return result;
  }

  async processEvent({
    event,
    client,
    now = new Date(),
  }: {
    event: HaloOutboxEvent;
    client: HaloClient;
    now?: Date;
  }): Promise<EventOutcome> {
    try {
      const link = await db.haloTicketLink.findUnique({
        where: { id: event.linkId },
        include: { connection: true },
      });
      if (!link) throw new HaloPermanentError(`Ticket link ${event.linkId} no longer exists`);

      await executeOutboxEvent({ client, event, link });
      const kept = await finishClaimedEvent({ event, data: { status: 'done', lastError: null } });
      return kept ? 'done' : this.leaseLost(event);
    } catch (error) {
      return this.recordFailure({ event, error, now });
    }
  }

  private async recordFailure({
    event,
    error,
    now,
  }: {
    event: HaloOutboxEvent;
    error: unknown;
    now: Date;
  }): Promise<EventOutcome> {
    const message = redactSecrets(errorMessage(error)).slice(0, 1000);

    if (error instanceof HaloDeferError) {
      const kept = await finishClaimedEvent({
        event,
        data: { status: 'pending', nextAttemptAt: new Date(now.getTime() + DEFER_DELAY_MS), lastError: message },
      });
      return kept ? 'deferred' : this.leaseLost(event);
    }

    const attempts = event.attempts + 1;
    const wasAmbiguous = (event.lastError ?? '').startsWith(AMBIGUOUS_PREFIX);
    const ambiguous = WRITE_KINDS.has(event.kind) && (wasAmbiguous || isAmbiguousWriteError(error));
    const lastError = ambiguous ? `${AMBIGUOUS_PREFIX}${message}` : message;
    const dead = error instanceof HaloPermanentError || attempts >= HALO_OUTBOX_MAX_ATTEMPTS;

    const kept = await finishClaimedEvent({
      event,
      data: {
        attempts,
        lastError,
        status: dead ? 'dead' : 'pending',
        nextAttemptAt: dead ? now : new Date(now.getTime() + backoffDelayMs(attempts)),
      },
    });
    if (!kept) return this.leaseLost(event);
    this.logger.warn(`Halo outbox ${event.kind} ${event.id} failed (attempt ${attempts}): ${message}`);
    return dead ? 'dead' : 'retried';
  }

  private leaseLost(event: HaloOutboxEvent): 'lost' {
    this.logger.warn(`Halo outbox ${event.kind} ${event.id}: lease expired before completion; outcome dropped`);
    return 'lost';
  }

  async list({ status, limit = 100 }: { status?: HaloOutboxStatus; limit?: number }) {
    const events = await db.haloOutboxEvent.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
      include: { organization: { select: { id: true, name: true } } },
    });
    return events.map(({ payload: _payload, ...event }) => event);
  }

  async retry({ id, now = new Date() }: { id: string; now?: Date }) {
    const event = await db.haloOutboxEvent.findFirst({
      where: { id, status: 'dead' },
      select: { organizationId: true },
    });
    const result = event
      ? await db.haloOutboxEvent.updateMany({
          where: { id, status: 'dead' },
          data: { status: 'pending', attempts: 0, nextAttemptAt: now },
        })
      : { count: 0 };
    if (!event || result.count === 0) throw new NotFoundException(`Dead outbox event ${id} not found`);
    return { id, status: 'pending' as const, organizationId: event.organizationId };
  }
}
