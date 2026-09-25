import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { db } from '@db';
import { MSP_TECH_ROLE, ensureMspTechRole } from '../roles/msp-tech-role';
import {
  FORBIDDEN_MSP_ORG_ROLES,
  MSP_ASSIGNABLE_USER_ROLES,
  isMspAssignableUserRole,
  planMembershipChanges,
  type MembershipAction,
} from './msp-staff-plan';

const BUILT_IN_ASSIGNABLE_ROLES = ['admin', 'auditor', 'employee', 'contractor'];

const STAFF_SELECT = {
  id: true,
  role: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true, role: true } },
} as const;

@Injectable()
export class AdminMspStaffService {
  private readonly logger = new Logger(AdminMspStaffService.name);

  async listStaff(orgId: string) {
    await this.requireOrg(orgId);
    const data = await db.member.findMany({
      where: {
        organizationId: orgId,
        deactivated: false,
        user: { role: { in: [...MSP_ASSIGNABLE_USER_ROLES] } },
      },
      select: STAFF_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return { data, count: data.length };
  }

  async addStaff({
    orgId,
    userIds,
    orgRole,
  }: {
    orgId: string;
    userIds: string[];
    orgRole: string;
  }): Promise<{ data: MembershipAction[]; count: number }> {
    await this.requireOrg(orgId);
    await this.resolveOrgRole({ orgId, orgRole });

    const uniqueIds = [...new Set(userIds)];
    const users = await db.user.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, role: true },
    });
    const found = new Set(users.map((u) => u.id));
    const missing = uniqueIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`Users not found: ${missing.join(', ')}`);
    }
    const notStaff = users.filter((u) => !isMspAssignableUserRole(u.role));
    if (notStaff.length > 0) {
      throw new BadRequestException(
        `Only users with global role msp_staff or admin can be assigned. Rejected: ${notStaff.map((u) => u.id).join(', ')}`,
      );
    }

    const existing = await db.member.findMany({
      where: { organizationId: orgId, userId: { in: uniqueIds } },
      select: { userId: true, role: true, deactivated: true, isActive: true },
    });
    const plan = planMembershipChanges({ userIds: uniqueIds, orgRole, existing });
    const changes = plan.filter((p) => p.action !== 'unchanged');

    await db.$transaction(
      changes.map((change) =>
        db.member.upsert({
          where: {
            userId_organizationId: { userId: change.userId, organizationId: orgId },
          },
          create: {
            userId: change.userId,
            organizationId: orgId,
            role: change.role,
            isActive: true,
          },
          update: {
            role: change.role,
            isActive: true,
            deactivated: false,
            offboardDate: null,
          },
        }),
      ),
    );

    this.logger.log(
      `MSP staff assignment for org ${orgId}: ${changes.length} changed, ${plan.length - changes.length} unchanged`,
    );
    return { data: plan, count: plan.length };
  }

  async removeStaff({ orgId, userId }: { orgId: string; userId: string }) {
    const member = await db.member.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      select: { id: true, role: true, deactivated: true, user: { select: { role: true } } },
    });
    if (!member) {
      throw new NotFoundException('User is not a member of this organization');
    }
    if (!isMspAssignableUserRole(member.user.role)) {
      throw new BadRequestException(
        'Only MSP staff memberships can be removed with this endpoint',
      );
    }
    if (member.role.split(',').map((r) => r.trim()).includes('owner')) {
      throw new BadRequestException('Cannot deactivate the organization owner');
    }

    await db.member.update({
      where: { id: member.id },
      data: { deactivated: true, isActive: false },
    });
    return { success: true, memberId: member.id };
  }

  private async requireOrg(orgId: string) {
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) throw new NotFoundException(`Organization ${orgId} not found`);
  }

  /** Validate the org role and make sure msp_tech exists when requested. */
  private async resolveOrgRole({ orgId, orgRole }: { orgId: string; orgRole: string }) {
    if (FORBIDDEN_MSP_ORG_ROLES.includes(orgRole)) {
      throw new BadRequestException(`Role '${orgRole}' cannot be assigned to MSP staff`);
    }
    if (orgRole === MSP_TECH_ROLE) {
      await ensureMspTechRole(orgId);
      return;
    }
    if (BUILT_IN_ASSIGNABLE_ROLES.includes(orgRole)) return;

    const custom = await db.organizationRole.findUnique({
      where: { organizationId_name: { organizationId: orgId, name: orgRole } },
      select: { id: true },
    });
    if (!custom) {
      throw new BadRequestException(`Role '${orgRole}' does not exist in this organization`);
    }
  }
}
