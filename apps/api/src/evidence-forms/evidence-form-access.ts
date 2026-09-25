import { UnauthorizedException } from '@nestjs/common';
import {
  permissionsGrant,
  resolveRolePermissions,
} from '../auth/app-access';
import type { AuthContext } from '../auth/types';

const EVIDENCE_FORM_REVIEWER_ROLES = ['owner', 'admin', 'auditor'] as const;
const EVIDENCE_FORM_DELETE_ROLES = ['owner', 'admin'] as const;
const BUILT_IN_ROLES = new Set([
  'owner',
  'admin',
  'auditor',
  'employee',
  'contractor',
]);

export function requireJwtUser(authContext: AuthContext): string {
  if (authContext.isApiKey || authContext.authType === 'api-key') {
    throw new UnauthorizedException(
      'This endpoint requires JWT authentication and does not support API key authentication',
    );
  }

  if (!authContext.userId) {
    throw new UnauthorizedException('Authenticated user session is required');
  }

  return authContext.userId;
}

/**
 * Built-in roles keep their original fixed list. Custom roles (e.g. msp_tech)
 * qualify through their resolved permissions for the equivalent action, since
 * custom role names can never appear in the fixed list.
 */
async function hasEvidenceAccess({
  organizationId,
  roles,
  allowedRoles,
  action,
}: {
  organizationId: string;
  roles: string[];
  allowedRoles: readonly string[];
  action: 'read' | 'update' | 'delete';
}): Promise<boolean> {
  if (allowedRoles.some((role) => roles.includes(role))) return true;
  const customRoles = roles.filter((role) => !BUILT_IN_ROLES.has(role));
  if (customRoles.length === 0) return false;
  const permissions = await resolveRolePermissions(organizationId, customRoles);
  return permissionsGrant(permissions, 'evidence', action);
}

export async function requirePrivilegedEvidenceAccess({
  organizationId,
  authContext,
  customRoleAction = 'read',
}: {
  organizationId: string;
  authContext: AuthContext;
  /** Permission a custom role needs: `read` to view, `update` to review. */
  customRoleAction?: 'read' | 'update';
}): Promise<string> {
  const userId = requireJwtUser(authContext);
  const allowed = await hasEvidenceAccess({
    organizationId,
    roles: authContext.userRoles ?? [],
    allowedRoles: EVIDENCE_FORM_REVIEWER_ROLES,
    action: customRoleAction,
  });
  if (!allowed) {
    throw new UnauthorizedException(
      `Access denied. Required one of roles: ${EVIDENCE_FORM_REVIEWER_ROLES.join(', ')}`,
    );
  }
  return userId;
}

export async function requireEvidenceDeleteAccess({
  organizationId,
  authContext,
}: {
  organizationId: string;
  authContext: AuthContext;
}): Promise<string> {
  const userId = requireJwtUser(authContext);
  const allowed = await hasEvidenceAccess({
    organizationId,
    roles: authContext.userRoles ?? [],
    allowedRoles: EVIDENCE_FORM_DELETE_ROLES,
    action: 'delete',
  });
  if (!allowed) {
    throw new UnauthorizedException(
      `Delete denied. Required one of roles: ${EVIDENCE_FORM_DELETE_ROLES.join(', ')}`,
    );
  }
  return userId;
}
