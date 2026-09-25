import { db, type IntegrationConnection } from '@db';
import {
  haloMappingFromMetadata,
  parseHaloAlertSettings,
  type HaloAlertSettings,
  type HaloConnectionMapping,
} from '@trycompai/integration-platform';
import type { CheckVariableValues } from '@trycompai/integration-platform';
import { HALOPSA_PROVIDER_SLUG } from './halopsa.constants';

export interface HaloOrgConnection {
  connection: IntegrationConnection;
  settings: HaloAlertSettings;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function toVariableValues(value: unknown): CheckVariableValues {
  const out: CheckVariableValues = {};
  for (const [key, raw] of Object.entries(asRecord(value))) {
    if (
      typeof raw === 'string' ||
      typeof raw === 'number' ||
      typeof raw === 'boolean' ||
      (Array.isArray(raw) && raw.every((v) => typeof v === 'string'))
    ) {
      out[key] = raw;
    }
  }
  return out;
}

/** The org's active `halopsa` connection with its parsed alert settings, or null. */
export async function loadHaloOrgConnection(
  organizationId: string,
): Promise<HaloOrgConnection | null> {
  const connection = await db.integrationConnection.findFirst({
    where: {
      organizationId,
      status: 'active',
      provider: { slug: HALOPSA_PROVIDER_SLUG },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!connection) return null;
  return {
    connection,
    settings: parseHaloAlertSettings(toVariableValues(connection.variables)),
  };
}

/**
 * The Halo client/site of a connection, read ONLY from the binding the
 * platform-admin bind flow writes into metadata. Credentials and variables
 * are customer-editable and are never consulted. Null when unbound.
 */
export function resolveMappingForConnection(
  connection: Pick<IntegrationConnection, 'metadata'>,
): HaloConnectionMapping | null {
  return haloMappingFromMetadata(connection.metadata);
}
