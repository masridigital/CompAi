import { Logger } from '@nestjs/common';
import { tasks } from '@trigger.dev/sdk';
import { HALO_DRAIN_TASK_ID, isOutboxPaused } from './halopsa.constants';

const logger = new Logger('HaloDrainTrigger');

/** One immediate drain per minute; the every-minute schedule covers the rest. */
export function drainIdempotencyKey(now: Date = new Date()): string {
  return `halopsa-drain:${now.toISOString().slice(0, 16)}`;
}

/**
 * Kick the outbox drain right after an enqueue so tickets land within seconds
 * instead of waiting for the next scheduled tick. Never throws.
 */
export async function triggerDrainSoon(now: Date = new Date()): Promise<void> {
  if (isOutboxPaused()) return;
  if (!process.env.TRIGGER_SECRET_KEY) return;
  try {
    await tasks.trigger(
      HALO_DRAIN_TASK_ID,
      {},
      { idempotencyKey: drainIdempotencyKey(now), idempotencyKeyTTL: '2m' },
    );
  } catch (error) {
    logger.warn(
      `Could not trigger ${HALO_DRAIN_TASK_ID}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
