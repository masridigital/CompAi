import type { IntegrationHandler } from '../../types';
import {
  createHaloClient,
  HaloApiError,
  HaloAuthError,
  HaloConfigError,
  type HaloClientOptions,
} from './client';

const NOT_CONFIGURED = 'HaloPSA is not configured on this server. Contact your MSP administrator.';

/**
 * Test HaloPSA reachability. Without a client id it only checks that the
 * server-wide HALOPSA_* application is configured (the customer "Test
 * connection" button has no binding to test); with one it also looks the
 * client up. Messages are customer-safe: no env names or Halo response bodies.
 */
export async function testHaloConnection({
  haloClientId,
  clientOptions,
}: {
  haloClientId?: number;
  clientOptions?: HaloClientOptions;
} = {}): Promise<boolean> {
  let halo;
  try {
    halo = createHaloClient(clientOptions);
  } catch (err) {
    if (err instanceof HaloConfigError) throw new Error(NOT_CONFIGURED);
    throw err;
  }
  if (haloClientId === undefined) return true;

  try {
    const client = await halo.getClient(haloClientId);
    if (client.inactive === true) {
      throw new Error(`Halo client ${client.id} is inactive in HaloPSA.`);
    }
    return true;
  } catch (err) {
    if (err instanceof HaloApiError && err.status === 404) {
      throw new Error(`Halo client ${haloClientId} was not found in HaloPSA.`);
    }
    if (err instanceof HaloApiError || err instanceof HaloAuthError) {
      throw new Error(`HaloPSA request failed (status ${err.status ?? 'unknown'})`);
    }
    throw err;
  }
}

export const halopsaHandler: IntegrationHandler = {
  testConnection: () => testHaloConnection(),
};
