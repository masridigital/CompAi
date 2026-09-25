import { Logger } from '@nestjs/common';
import { db, type Prisma } from '@db';

const logger = new Logger('HaloAdminAudit');

export type HaloAdminAuditAction =
  | 'bind_client'
  | 'create_org_from_client'
  | 'issue_webhook_token'
  | 'retry_outbox_event';

const DESCRIPTIONS: Record<HaloAdminAuditAction, string> = {
  bind_client: 'Bound HaloPSA client',
  create_org_from_client: 'Created organization from HaloPSA client',
  issue_webhook_token: 'Issued HaloPSA webhook token',
  retry_outbox_event: 'Retried HaloPSA outbox event',
};

/**
 * Audit row for a platform-admin HaloPSA action, filed under the AFFECTED
 * organization (not the admin's own org). Never throws: a failed audit write
 * is logged and must not undo the action.
 */
export async function writeHaloAdminAudit({
  userId,
  organizationId,
  action,
  entityId,
  details = {},
}: {
  userId: string;
  organizationId: string;
  action: HaloAdminAuditAction;
  entityId: string;
  details?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  const description = `[Platform Admin] ${DESCRIPTIONS[action]}`;
  const data: Prisma.InputJsonObject = {
    action,
    resource: 'admin-halopsa',
    permission: 'platform-admin',
    ...details,
  };
  try {
    await db.auditLog.create({
      data: {
        userId,
        memberId: null,
        organizationId,
        entityType: 'integration',
        entityId,
        description,
        data,
      },
    });
  } catch (error) {
    logger.error(
      `Failed to write HaloPSA admin audit (${action}, org ${organizationId}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
