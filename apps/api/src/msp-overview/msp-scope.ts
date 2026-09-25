import { permissionsGrant } from '../auth/app-access';
import type { AuthenticatedRequest } from '../auth/types';

/** Global User.role values allowed to use the MSP master pane. */
export type MspRole = 'admin' | 'msp_staff';

/** Request after HybridAuthGuard + MspStaffGuard. */
export interface MspRequest extends AuthenticatedRequest {
  mspRole?: MspRole;
}

export interface MspOrg {
  id: string;
  name: string;
  logo: string | null;
}

/**
 * The set of client orgs one staff user may see in the master pane, with the
 * user's resolved permissions per org. Every master-pane query is bounded to
 * `orgs` (and, per data type, to the orgs whose permissions grant `read`).
 */
export interface MspScope {
  isPlatformAdmin: boolean;
  orgs: MspOrg[];
  /** Resolved member permissions per org (unused for platform admins). */
  permissionsByOrg: Map<string, Record<string, string[]>>;
}

/** Resources whose `read` permission gates a master-pane data type. */
export type MspResource =
  | 'task'
  | 'finding'
  | 'integration'
  | 'evidence'
  | 'framework'
  | 'policy'
  | 'app';

/**
 * Global User.role → master-pane role. `admin` must be the exact value (same
 * rule as PlatformAdminGuard / HybridAuthGuard.isPlatformAdmin); `msp_staff`
 * may appear in a comma-separated list. Anything else → null (no access).
 */
export function parseMspRole(role: string | null | undefined): MspRole | null {
  if (!role) return null;
  if (role === 'admin') return 'admin';
  const roles = role.split(',').map((r) => r.trim());
  return roles.includes('msp_staff') ? 'msp_staff' : null;
}

export function canReadInOrg({
  scope,
  organizationId,
  resource,
}: {
  scope: MspScope;
  organizationId: string;
  resource: MspResource;
}): boolean {
  if (!scope.orgs.some((org) => org.id === organizationId)) return false;
  if (scope.isPlatformAdmin) return true;
  const perms = scope.permissionsByOrg.get(organizationId);
  return perms ? permissionsGrant(perms, resource, 'read') : false;
}

/** Ids of the orgs in scope where the user may read `resource`. */
export function orgIdsWithRead({
  scope,
  resource,
}: {
  scope: MspScope;
  resource: MspResource;
}): string[] {
  return scope.orgs
    .filter((org) => canReadInOrg({ scope, organizationId: org.id, resource }))
    .map((org) => org.id);
}

export function orgNameMap(scope: MspScope): Map<string, string> {
  return new Map(scope.orgs.map((org) => [org.id, org.name]));
}
