import { logger, schedules } from '@trigger.dev/sdk';
import { triggerDrainSoon } from '../../../integration-platform/halopsa/halopsa-drain-trigger';
import { HaloMonthlyReportService } from '../../../integration-platform/halopsa/halopsa-monthly-report.service';

/** 1st of each month, 09:00 UTC: monthly posture PDF on a Halo ticket per client. */
export const halopsaMonthlyReport = schedules.task({
  id: 'halopsa-monthly-report',
  cron: '0 9 1 * *',
  maxDuration: 60 * 30,
  run: async (payload) => {
    const service = new HaloMonthlyReportService();
    const orgIds = await service.listReportOrganizations();
    const outcomes: Record<string, number> = {};

    for (const organizationId of orgIds) {
      try {
        const outcome = await service.runForOrganization({ organizationId, now: payload.timestamp });
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      } catch (error) {
        outcomes.error = (outcomes.error ?? 0) + 1;
        logger.error(`Monthly report failed for ${organizationId}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (outcomes.queued) await triggerDrainSoon();
    logger.info('HaloPSA monthly reports done', { organizations: orgIds.length, ...outcomes });
    return { organizations: orgIds.length, outcomes };
  },
});
