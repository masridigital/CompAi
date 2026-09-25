import type { IntegrationCredentials, IntegrationHandler } from '../../types';
import { createHaloClient, HaloApiError, type HaloClientOptions } from './client';
import { resolveHaloConnectionMapping } from './credentials';

/**
 * Test a HaloPSA connection: the server env must be configured and the mapped
 * Halo client must exist. Throws with a user-facing message on failure (the
 * connections controller surfaces `err.message`).
 */
export async function testHaloConnection({
  credentials,
  clientOptions,
}: {
  credentials: IntegrationCredentials;
  clientOptions?: HaloClientOptions;
}): Promise<boolean> {
  const mapping = resolveHaloConnectionMapping({ credentials });
  if (!mapping.success) throw new Error(mapping.error);

  // Throws HaloConfigError naming the missing HALOPSA_* variables.
  const halo = createHaloClient(clientOptions);

  try {
    const client = await halo.getClient(mapping.data.haloClientId);
    if (client.inactive === true) {
      throw new Error(`Halo client ${client.id} (${client.name}) is inactive in HaloPSA.`);
    }
    return true;
  } catch (err) {
    if (err instanceof HaloApiError && err.status === 404) {
      throw new Error(`Halo client ${mapping.data.haloClientId} was not found in HaloPSA.`);
    }
    if (err instanceof HaloApiError && (err.status === 401 || err.status === 403)) {
      throw new Error(
        `HaloPSA denied access (HTTP ${err.status}). Check the Halo API application's scopes include read:customers.`,
      );
    }
    throw err;
  }
}

export const halopsaHandler: IntegrationHandler = {
  testConnection: (credentials) => testHaloConnection({ credentials }),
};
