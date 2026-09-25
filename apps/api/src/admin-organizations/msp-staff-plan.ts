/**
 * Pure planning logic for assigning MSP staff to client organizations. Shared
 * by the admin endpoint and `scripts/assign-msp-staff.ts` so both produce the
 * same membership changes. No I/O here.
 */

/** Global `User.role` values that may be assigned as MSP staff. */
export const MSP_ASSIGNABLE_USER_ROLES: readonly string[] = ['msp_staff', 'admin'];

/** Org roles that may never be granted through MSP staff assignment. */
export const FORBIDDEN_MSP_ORG_ROLES: readonly string[] = ['owner'];

export interface ExistingMembership {
  userId: string;
  role: string;
  deactivated: boolean;
  isActive: boolean;
}

export type MembershipActionKind =
  | 'create'
  | 'reactivate'
  | 'add-role'
  | 'unchanged';

export interface MembershipAction {
  userId: string;
  action: MembershipActionKind;
  /** Role string the member row ends up with. */
  role: string;
}

export function isMspAssignableUserRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return MSP_ASSIGNABLE_USER_ROLES.includes(role);
}

function splitRoles(role: string): string[] {
  return role
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

/** Union `orgRole` into an existing comma-separated role string. */
export function mergeRole({
  existing,
  orgRole,
}: {
  existing: string;
  orgRole: string;
}): string {
  const roles = splitRoles(existing);
  if (roles.includes(orgRole)) return roles.join(',');
  return [...roles, orgRole].join(',');
}

/**
 * Decide, per user, what happens to their membership in one org:
 * - no row: create with `orgRole`
 * - deactivated/inactive row: reactivate with `orgRole` (old roles dropped)
 * - active row without `orgRole`: add it to their roles
 * - active row with `orgRole`: unchanged
 */
export function planMembershipChanges({
  userIds,
  orgRole,
  existing,
}: {
  userIds: string[];
  orgRole: string;
  existing: ExistingMembership[];
}): MembershipAction[] {
  const byUser = new Map(existing.map((m) => [m.userId, m]));
  return [...new Set(userIds)].map((userId) => {
    const member = byUser.get(userId);
    if (!member) return { userId, action: 'create', role: orgRole };
    if (member.deactivated || !member.isActive) {
      return { userId, action: 'reactivate', role: orgRole };
    }
    const merged = mergeRole({ existing: member.role, orgRole });
    if (splitRoles(member.role).includes(orgRole)) {
      return { userId, action: 'unchanged', role: merged };
    }
    return { userId, action: 'add-role', role: merged };
  });
}
