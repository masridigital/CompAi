import { createHaloClient, isHaloConfigured } from '@trycompai/integration-platform';
import { logger, schedules } from '@trigger.dev/sdk';
import { db } from '@db';
import { resolveMappingForConnection } from '../../../integration-platform/halopsa/halopsa-connection';
import { HALOPSA_PROVIDER_SLUG } from '../../../integration-platform/halopsa/halopsa.constants';

/**
 * Nightly: count active Halo clients that are not bound to any org. Nothing
 * is cached in the DB; the admin HaloPSA page reads Halo live.
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
        where: { provider: { slug: HALOPSA_PROVIDER_SLUG } },
        select: { id: true, metadata: true, variables: true },
      }),
    ]);

    const mapped = new Set<number>();
    for (const connection of connections) {
      try {
        const mapping = await resolveMappingForConnection(connection);
        if (mapping) mapped.add(mapping.haloClientId);
      } catch (error) {
        logger.warn(`Could not resolve Halo mapping for ${connection.id}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const unmapped = clients.filter((client) => !mapped.has(client.id)).length;
    logger.info('HaloPSA client mapping status', {
      activeClients: clients.length,
      mappedClients: mapped.size,
      unmappedClients: unmapped,
    });
    return { activeClients: clients.length, mappedClients: mapped.size, unmappedClients: unmapped };
  },
});
