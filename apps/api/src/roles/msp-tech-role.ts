import { BUILT_IN_ROLE_PERMISSIONS } from '@trycompai/auth';
import { db } from '@db';

/** Custom org role given to MSP technicians in the client orgs they support. */
export const MSP_TECH_ROLE = 'msp_tech';

/**
 * Resources an MSP tech never gets, whatever the action: API keys (long-lived
 * org credentials) and the secrets manager (decrypted client credentials).
 */
const EXCLUDED_RESOURCES = new Set(['apiKey', 'secret']);

/** Single actions removed on top of the excluded resources. */
const EXCLUDED_ACTIONS: Record<string, string[]> = {
  organization: ['delete'],
};

/**
 * `msp_tech` permissions: the built-in `admin` role minus `organization:delete`,
 * `apiKey:*` and `secret:*`. Derived from the admin definition so new admin
 * permissions flow through automatically (except the exclusions).
 */
export function buildMspTechPermissions(): Record<string, string[]> {
  const adminPermissions = BUILT_IN_ROLE_PERMISSIONS.admin ?? {};
  const result: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(adminPermissions)) {
    if (EXCLUDED_RESOURCES.has(resource)) continue;
    const blocked = EXCLUDED_ACTIONS[resource] ?? [];
    const allowed = actions.filter((action) => !blocked.includes(action));
    if (allowed.length === 0) continue;
    result[resource] = allowed;
  }
  return result;
}

/**
 * Create or refresh the `msp_tech` custom role in an organization. Idempotent:
 * an existing row has its permissions reset to the canonical set. MSP techs
 * carry no compliance obligation (they are not client employees).
 */
export async function ensureMspTechRole(organizationId: string) {
  const permissions = JSON.stringify(buildMspTechPermissions());
  return db.organizationRole.upsert({
    where: { organizationId_name: { organizationId, name: MSP_TECH_ROLE } },
    create: {
      organizationId,
      name: MSP_TECH_ROLE,
      permissions,
      obligations: JSON.stringify({}),
    },
    update: { permissions },
  });
}
