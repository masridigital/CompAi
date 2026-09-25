import { db } from '@db';
import { asRecord } from './halopsa-connection';
import { HALOPSA_PROVIDER_SLUG } from './halopsa.constants';

export interface HaloClientRef {
  id: number;
  name: string | null;
  /** Link to the client in the Halo agent UI, when HALOPSA_BASE_URL is set. */
  url: string | null;
}

/**
 * Halo agent UI link for a client. Halo opens a customer at
 * `/customers?clientid={id}`; unconfirmed for every Halo version, so the
 * admin UI always shows the name and id as well.
 */
export function haloClientUrl(id: number, env: NodeJS.ProcessEnv = process.env): string | null {
  const base = env.HALOPSA_BASE_URL?.trim().replace(/\/+$/, '');
  return base ? `${base}/customers?clientid=${id}` : null;
}

export function haloClientRefFromMetadata(metadata: unknown): HaloClientRef | null {
  const meta = asRecord(metadata);
  const id = Number(meta.haloClientId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const name = typeof meta.haloClientName === 'string' && meta.haloClientName ? meta.haloClientName : null;
  return { id, name, url: haloClientUrl(id) };
}

/**
 * Halo client per org for an admin list page, in ONE query and without
 * decrypting credentials: reads the haloClientId / haloClientName cached in
 * connection metadata by the admin bind flow.
 */
export async function loadHaloClientsForOrganizations(
  organizationIds: string[],
): Promise<Map<string, HaloClientRef>> {
  const result = new Map<string, HaloClientRef>();
  if (organizationIds.length === 0) return result;

  const connections = await db.integrationConnection.findMany({
    where: {
      organizationId: { in: organizationIds },
      status: 'active',
      provider: { slug: HALOPSA_PROVIDER_SLUG },
    },
    select: { organizationId: true, metadata: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const connection of connections) {
    if (result.has(connection.organizationId)) continue;
    const ref = haloClientRefFromMetadata(connection.metadata);
    if (ref) result.set(connection.organizationId, ref);
  }
  return result;
}
