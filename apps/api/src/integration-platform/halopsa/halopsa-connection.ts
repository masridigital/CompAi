import { db, type IntegrationConnection } from '@db';
import {
  parseHaloAlertSettings,
  resolveHaloConnectionMapping,
  type HaloAlertSettings,
  type HaloConnectionMapping,
} from '@trycompai/integration-platform';
import type { CheckVariableValues } from '@trycompai/integration-platform';
import { ConnectionRepository } from '../repositories/connection.repository';
import { CredentialRepository } from '../repositories/credential.repository';
import { CredentialVaultService } from '../services/credential-vault.service';
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
 * Resolve the Halo client/site for a connection without decrypting when
 * possible: metadata (written by the admin bind flow) and variables first,
 * then the encrypted credentials via the credential vault.
 */
export async function resolveMappingForConnection(
  connection: Pick<IntegrationConnection, 'id' | 'metadata' | 'variables'>,
): Promise<HaloConnectionMapping | null> {
  const plain = resolveHaloConnectionMapping({
    credentials: asRecord(connection.metadata),
    variables: asRecord(connection.variables),
  });
  if (plain.success) return plain.data;

  const vault = new CredentialVaultService(new CredentialRepository(), new ConnectionRepository());
  const credentials = await vault.getDecryptedCredentials(connection.id);
  if (!credentials) return null;
  const resolved = resolveHaloConnectionMapping({ credentials });
  return resolved.success ? resolved.data : null;
}
