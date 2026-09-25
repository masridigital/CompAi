import { db } from '@db';
import { assertCanGrantRoles } from '../roles/role-grant';

/**
 * better-auth organization endpoints that assign a role. They are reachable
 * directly over HTTP (the app calls updateMemberRole from the People page), so
 * they need the same "cannot grant more than you have" rule as /v1/people.
 */
export const ROLE_GRANTING_AUTH_PATHS = new Set([
  '/organization/update-member-role',
  '/organization/invite-member',
]);

function readRoles(body: unknown): string | string[] | null {
  if (!body || typeof body !== 'object') return null;
  const role = (body as Record<string, unknown>).role;
  if (typeof role === 'string') return role;
  if (Array.isArray(role) && role.every((r) => typeof r === 'string')) return role;
  return null;
}

function readOrganizationId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const id = (body as Record<string, unknown>).organizationId;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Throws ForbiddenException when the session user would grant a role carrying
 * permissions they do not hold. No-ops for other paths, platform admins, and
 * requests better-auth itself will reject (no role, no org, not a member).
 */
export async function enforceOrgRoleGrant({
  path,
  body,
  userId,
  userRole,
  activeOrganizationId,
}: {
  path: string;
  body: unknown;
  userId: string | null | undefined;
  userRole: string | null | undefined;
  activeOrganizationId: string | null | undefined;
}): Promise<void> {
  if (!ROLE_GRANTING_AUTH_PATHS.has(path)) return;
  if (!userId || userRole === 'admin') return;

  const targetRoles = readRoles(body);
  const organizationId = readOrganizationId(body) ?? activeOrganizationId;
  if (!targetRoles || !organizationId) return;

  const caller = await db.member.findFirst({
    where: { userId, organizationId, deactivated: false },
    select: { role: true },
  });
  if (!caller) return;

  await assertCanGrantRoles({
    organizationId,
    targetRoles,
    callerRoles: caller.role.split(',').map((r) => r.trim()).filter(Boolean),
  });
}
