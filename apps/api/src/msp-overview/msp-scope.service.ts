import { Injectable } from '@nestjs/common';
import { db } from '@db';
import { permissionsGrant, resolveRolePermissions } from '../auth/app-access';
import type { MspOrg, MspRole, MspScope } from './msp-scope';

function splitRoles(role: string | null): string[] {
  if (!role) return [];
  return role
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * Resolves which client orgs a staff user sees in the master pane.
 *
 * - admin: every org with `hasAccess` or `onboardingCompleted`.
 * - msp_staff: only orgs where the user has an active, non-deactivated
 *   Member row whose role(s) grant `app:read` (portal-only memberships such
 *   as employee/contractor are excluded, as they do not grant app access).
 *   Permissions come from `resolveRolePermissions`, the same resolver
 *   PermissionGuard uses (built-in + custom organization_role rows).
 */
@Injectable()
export class MspScopeService {
  async resolve({
    userId,
    role,
  }: {
    userId: string;
    role: MspRole;
  }): Promise<MspScope> {
    if (role === 'admin') return this.resolveAdmin();
    return this.resolveStaff(userId);
  }

  private async resolveAdmin(): Promise<MspScope> {
    const orgs = await db.organization.findMany({
      where: { OR: [{ hasAccess: true }, { onboardingCompleted: true }] },
      select: { id: true, name: true, logo: true },
      orderBy: { name: 'asc' },
    });
    return { isPlatformAdmin: true, orgs, permissionsByOrg: new Map() };
  }

  private async resolveStaff(userId: string): Promise<MspScope> {
    const members = await db.member.findMany({
      where: { userId, isActive: true, deactivated: false },
      select: {
        organizationId: true,
        role: true,
        organization: { select: { id: true, name: true, logo: true } },
      },
    });

    const resolved = await Promise.all(
      members.map(async (member) => ({
        org: member.organization,
        permissions: await resolveRolePermissions(
          member.organizationId,
          splitRoles(member.role),
        ),
      })),
    );

    const orgs: MspOrg[] = [];
    const permissionsByOrg = new Map<string, Record<string, string[]>>();
    for (const { org, permissions } of resolved) {
      if (permissionsByOrg.has(org.id)) continue;
      if (!permissionsGrant(permissions, 'app', 'read')) continue;
      orgs.push(org);
      permissionsByOrg.set(org.id, permissions);
    }
    orgs.sort((a, b) => a.name.localeCompare(b.name));
    return { isPlatformAdmin: false, orgs, permissionsByOrg };
  }
}
