import type { IntegrationConnection } from '@db';
import { resolveMappingForConnection } from './halopsa-connection';

export interface ClientMappingStatus {
  activeClients: number;
  mappedClients: number;
  unmappedClients: number;
}

/**
 * Halo clients bound to an org. Only `active` connections count: a paused,
 * errored or disconnected connection sends nothing, so its client is
 * effectively unmapped. The binding comes from admin-written metadata only.
 */
export function clientMappingStatus({
  clients,
  connections,
}: {
  clients: Array<{ id: number }>;
  connections: Array<Pick<IntegrationConnection, 'status' | 'metadata'>>;
}): ClientMappingStatus {
  const mapped = new Set<number>();
  for (const connection of connections) {
    if (connection.status !== 'active') continue;
    const mapping = resolveMappingForConnection(connection);
    if (mapping) mapped.add(mapping.haloClientId);
  }
  const unmapped = clients.filter((client) => !mapped.has(client.id)).length;
  return { activeClients: clients.length, mappedClients: mapped.size, unmappedClients: unmapped };
}
