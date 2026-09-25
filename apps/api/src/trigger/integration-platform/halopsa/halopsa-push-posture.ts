import { logger, schedules } from '@trigger.dev/sdk';
import { triggerDrainSoon } from '../../../integration-platform/halopsa/halopsa-drain-trigger';
import { HaloPostureService } from '../../../integration-platform/halopsa/halopsa-posture.service';

/**
 * Plan 5.3: push each client's latest posture snapshot to its Halo client
 * custom fields. Runs on its own cron at 06:30 UTC, an hour after
 * client-posture-schedule (05:30) fans out; that fan-out returns before the
 * per-org snapshots finish, so chaining off it would race. Snapshots older
 * than 3 days are skipped.
 */
export const halopsaPushPosture = schedules.task({
  id: 'halopsa-push-posture',
  cron: '30 6 * * *',
  maxDuration: 60 * 15,
  run: async (payload) => {
    const result = await new HaloPostureService().enqueueAll({ now: payload.timestamp });
    if (result.enqueued > 0) await triggerDrainSoon();
    logger.info('Queued HaloPSA posture pushes', { ...result });
    return result;
  },
});
