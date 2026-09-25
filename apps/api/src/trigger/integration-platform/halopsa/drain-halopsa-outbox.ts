import { isHaloConfigured } from '@trycompai/integration-platform';
import { logger, queue, schedules, task } from '@trigger.dev/sdk';
import { HaloOutboxService } from '../../../integration-platform/halopsa/halopsa-outbox.service';
import { HALO_DRAIN_TASK_ID, isOutboxPaused } from '../../../integration-platform/halopsa/halopsa.constants';

const haloOutboxQueue = queue({ name: 'halopsa-outbox', concurrencyLimit: 5 });

export async function drainHaloOutbox() {
  if (isOutboxPaused()) {
    logger.info('HALOPSA_OUTBOX_PAUSED=true: outbox not drained');
    return { paused: true };
  }
  if (!isHaloConfigured()) {
    logger.warn('HALOPSA_* environment is incomplete: outbox not drained');
    return { paused: false, configured: false };
  }
  const result = await new HaloOutboxService().drain();
  if (result.claimed > 0) logger.info('Drained HaloPSA outbox', { ...result });
  return result;
}

/** Triggered right after an enqueue (idempotency key per minute). */
export const drainHalopsaOutbox = task({
  id: HALO_DRAIN_TASK_ID,
  queue: haloOutboxQueue,
  maxDuration: 60 * 5,
  retry: { maxAttempts: 1 },
  run: async () => drainHaloOutbox(),
});

/** Safety net: drain every minute so nothing waits on a missed trigger. */
export const drainHalopsaOutboxSchedule = schedules.task({
  id: 'drain-halopsa-outbox-schedule',
  cron: '* * * * *',
  queue: haloOutboxQueue,
  maxDuration: 60 * 5,
  run: async () => drainHaloOutbox(),
});
