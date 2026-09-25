import { createHaloClient, isHaloConfigured } from '@trycompai/integration-platform';
import { logger, schedules } from '@trigger.dev/sdk';
import { db } from '@db';
import { clientMappingStatus } from '../../../integration-platform/halopsa/halopsa-client-mapping-status';
import { HALOPSA_PROVIDER_SLUG } from '../../../integration-platform/halopsa/halopsa.constants';

/**
 * Nightly: count active Halo clients that are not bound to any org through
 * an active connection. Nothing is cached in the DB; the admin HaloPSA page
 * reads Halo live.
 */
export const halopsaSyncClients = schedules.task({
  id: 'halopsa-sync-clients',
  cron: '40 2 * * *',
  maxDuration: 60 * 10,
  run: async () => {
    if (!isHaloConfigured()) {
      logger.warn('HALOPSA_* environment is incomplete: client sync skipped');
      return { skipped: true };
    }

    const [clients, connections] = await Promise.all([
      createHaloClient().listClients(),
      db.integrationConnection.findMany({
        where: { provider: { slug: HALOPSA_PROVIDER_SLUG }, status: 'active' },
        select: { status: true, metadata: true },
      }),
    ]);

    const status = clientMappingStatus({ clients, connections });
    logger.info('HaloPSA client mapping status', { ...status });
    return status;
  },
});
