import { BadRequestException } from '@nestjs/common';
import { AuditLogEntityType, Prisma } from '@db';

/**
 * Audit trail for PATCH /v1/admin/users/:userId/role.
 *
 * The route has no organization in scope, so AdminAuditLogInterceptor skips
 * it. AuditLog rows require an organization, so:
 *  - the role change itself is logged in the acting admin's organization
 *    (oldest active membership), falling back to the target user's; with
 *    neither, the change is refused rather than left unaudited (same policy
 *    as the better-auth /admin/* audit hook);
 *  - each deactivated msp_tech membership is logged in that membership's
 *    organization, so the client org sees why its tech lost access.
 * Written with the transaction client so the rows commit with the change.
 */

export interface DeactivatedMembership {
  id: string;
  organizationId: string;
}

async function resolveAuditOrganizationId({
  tx,
  adminUserId,
  userId,
}: {
  tx: Prisma.TransactionClient;
  adminUserId: string;
  userId: string;
}): Promise<string> {
  for (const candidate of [adminUserId, userId]) {
    const member = await tx.member.findFirst({
      where: { userId: candidate, deactivated: false },
      select: { organizationId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (member) return member.organizationId;
  }
  throw new BadRequestException(
    'Role change blocked: unable to resolve an organization for the audit trail',
  );
}

export async function writeGlobalRoleAuditLogs({
  tx,
  adminUserId,
  userId,
  previousRole,
  role,
  deactivated,
}: {
  tx: Prisma.TransactionClient;
  adminUserId: string;
  userId: string;
  previousRole: string | null;
  role: string;
  deactivated: DeactivatedMembership[];
}): Promise<void> {
  const path = `/v1/admin/users/${userId}/role`;
  const base = {
    method: 'PATCH',
    path,
    resource: 'admin',
    permission: 'platform-admin',
  };

  const organizationId = await resolveAuditOrganizationId({
    tx,
    adminUserId,
    userId,
  });
  const description = `[Platform Admin] Changed global role of user ${userId}: ${previousRole ?? 'none'} -> ${role}`;
  await tx.auditLog.create({
    data: {
      organizationId,
      userId: adminUserId,
      memberId: null,
      entityType: AuditLogEntityType.people,
      entityId: userId,
      description,
      data: {
        ...base,
        action: description,
        targetUserId: userId,
        changes: { role: { previous: previousRole, current: role } },
        deactivatedMemberIds: deactivated.map((m) => m.id),
      } satisfies Prisma.InputJsonValue,
    },
  });

  for (const membership of deactivated) {
    const memberDescription = `[Platform Admin] Deactivated msp_tech membership of user ${userId} after global role change to ${role}`;
    await tx.auditLog.create({
      data: {
        organizationId: membership.organizationId,
        userId: adminUserId,
        memberId: null,
        entityType: AuditLogEntityType.people,
        entityId: membership.id,
        description: memberDescription,
        data: {
          ...base,
          action: memberDescription,
          targetUserId: userId,
          memberId: membership.id,
          changes: { deactivated: true, isActive: false },
        } satisfies Prisma.InputJsonValue,
      },
    });
  }
}
