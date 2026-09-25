import { createHaloClient, isHaloConfigured } from '@trycompai/integration-platform';
import { logger, schedules } from '@trigger.dev/sdk';
import { HaloReconcileService } from '../../../integration-platform/halopsa/halopsa-reconcile.service';

/** Hourly: poll open Halo ticket links, since webhooks are best effort. */
export const halopsaReconcileTickets = schedules.task({
  id: 'halopsa-reconcile-tickets',
  cron: '17 * * * *',
  maxDuration: 60 * 15,
  run: async () => {
    if (!isHaloConfigured()) {
      logger.warn('HALOPSA_* environment is incomplete: reconcile skipped');
      return { skipped: true };
    }
    const result = await new HaloReconcileService().reconcile({ client: createHaloClient() });
    logger.info('Reconciled HaloPSA ticket links', { ...result });
    return result;
  },
});
