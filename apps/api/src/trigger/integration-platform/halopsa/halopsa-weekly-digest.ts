import { logger, schedules } from '@trigger.dev/sdk';
import { HaloDigestService } from '../../../integration-platform/halopsa/halopsa-digest.service';
import { triggerDrainSoon } from '../../../integration-platform/halopsa/halopsa-drain-trigger';

/**
 * Monday 08:00 UTC weekly due-items digest per org. The plan asks for the
 * client's timezone, but no per-org timezone is stored yet, so all orgs run
 * at 08:00 UTC.
 */
export const halopsaWeeklyDigest = schedules.task({
  id: 'halopsa-weekly-digest',
  cron: '0 8 * * 1',
  maxDuration: 60 * 15,
  run: async (payload) => {
    const service = new HaloDigestService();
    const orgIds = await service.listDigestOrganizations();
    const outcomes: Record<string, number> = {};

    for (const organizationId of orgIds) {
      try {
        const outcome = await service.runForOrganization({ organizationId, now: payload.timestamp });
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      } catch (error) {
        outcomes.error = (outcomes.error ?? 0) + 1;
        logger.error(`Weekly digest failed for ${organizationId}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (outcomes.created) await triggerDrainSoon();
    logger.info('HaloPSA weekly digest done', { organizations: orgIds.length, ...outcomes });
    return { organizations: orgIds.length, outcomes };
  },
});
