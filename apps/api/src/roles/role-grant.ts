import { ForbiddenException } from '@nestjs/common';
import {
  BUILT_IN_ROLE_PERMISSIONS,
  isRestrictedRole,
  parseRolePermissions,
} from '@trycompai/auth';
import { db } from '@db';

export type PermissionMap = Record<string, string[]>;

const OWNER_ROLE = 'owner';

/** Parse a comma-separated role string (or list) into clean role names. */
export function toRoleList(roles: string | string[] | null | undefined): string[] {
  const list = Array.isArray(roles) ? roles : (roles ?? '').split(',');
  return [...new Set(list.map((r) => r.trim()).filter(Boolean))];
}

/**
 * Permissions for each role name in the org: built-in definitions, else the
 * org's custom role. Unknown roles map to `null`.
 */
async function loadRolePermissions({
  organizationId,
  roles,
}: {
  organizationId: string;
  roles: string[];
}): Promise<Map<string, PermissionMap | null>> {
  const result = new Map<string, PermissionMap | null>();
  const customNames: string[] = [];
  for (const role of roles) {
    const builtIn = BUILT_IN_ROLE_PERMISSIONS[role];
    if (builtIn) result.set(role, builtIn);
    else customNames.push(role);
  }
  if (customNames.length === 0) return result;

  const rows = await db.organizationRole.findMany({
    where: { organizationId, name: { in: customNames } },
    select: { name: true, permissions: true },
  });
  const byName = new Map(rows.map((r) => [r.name, parseRolePermissions(r.permissions)]));
  for (const name of customNames) result.set(name, byName.get(name) ?? null);
  return result;
}

/** Union of the permissions of every (known) role in `roles`. */
export async function resolveCombinedPermissions({
  organizationId,
  roles,
}: {
  organizationId: string;
  roles: string[];
}): Promise<PermissionMap> {
  const perRole = await loadRolePermissions({ organizationId, roles });
  const combined: PermissionMap = {};
  for (const perms of perRole.values()) {
    for (const [resource, actions] of Object.entries(perms ?? {})) {
      combined[resource] = [...new Set([...(combined[resource] ?? []), ...actions])];
    }
  }
  return combined;
}

/** `resource:action` pairs in `target` that `caller` does not hold. */
export function missingPermissions({
  caller,
  target,
}: {
  caller: PermissionMap;
  target: PermissionMap;
}): string[] {
  const missing: string[] = [];
  for (const [resource, actions] of Object.entries(target)) {
    const held = caller[resource] ?? [];
    for (const action of actions) {
      if (!held.includes(action)) missing.push(`${resource}:${action}`);
    }
  }
  return missing;
}

/**
 * "Cannot grant more than you have": throws unless every role in
 * `targetRoles` only carries permissions the caller already holds.
 *
 * - Callers holding `owner` may grant anything (owner transfer rules are
 *   enforced separately where they apply).
 * - Nobody else may grant `owner`.
 * - The restricted portal-only roles (employee, contractor) grant no app
 *   access and stay assignable by anyone allowed to manage members.
 * - Unknown roles are rejected.
 */
export async function assertCanGrantRoles({
  organizationId,
  targetRoles,
  callerRoles,
}: {
  organizationId: string;
  targetRoles: string | string[];
  callerRoles: string[];
}): Promise<void> {
  const roles = toRoleList(targetRoles);
  if (roles.length === 0) return;
  if (callerRoles.includes(OWNER_ROLE)) return;

  if (roles.includes(OWNER_ROLE)) {
    throw new ForbiddenException('Only an organization owner can grant the owner role');
  }

  const caller = await resolveCombinedPermissions({ organizationId, roles: callerRoles });
  const perRole = await loadRolePermissions({ organizationId, roles });

  for (const role of roles) {
    if (isRestrictedRole(role)) continue;
    const perms = perRole.get(role);
    if (!perms) {
      throw new ForbiddenException(`Unknown role "${role}"`);
    }
    const missing = missingPermissions({ caller, target: perms });
    if (missing.length > 0) {
      throw new ForbiddenException(
        `You cannot grant the role "${role}": it includes ${missing.join(', ')}, which you do not hold`,
      );
    }
  }
}

/** The parts of the request auth context that decide what a caller may grant. */
export interface RoleGrantCaller {
  userRoles: string[] | null;
  isApiKey?: boolean;
  isServiceToken?: boolean;
  isPlatformAdmin?: boolean;
}

/**
 * {@link assertCanGrantRoles} for a request caller. Platform admins and
 * internal service tokens are trusted. API keys keep their existing,
 * scope-based rules (enforced by the invite service) and are not checked here.
 */
export async function assertCallerCanGrantRoles({
  organizationId,
  caller,
  targetRoles,
}: {
  organizationId: string;
  caller: RoleGrantCaller;
  targetRoles: string | string[];
}): Promise<void> {
  if (caller.isPlatformAdmin || caller.isServiceToken || caller.isApiKey) return;
  await assertCanGrantRoles({
    organizationId,
    targetRoles,
    callerRoles: caller.userRoles ?? [],
  });
}
