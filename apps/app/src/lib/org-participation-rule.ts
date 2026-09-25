/**
 * Pure, dependency-free org-participation rule.
 *
 * This is a deliberate mirror of `packages/auth/src/participation.ts`. The app
 * cannot import `@trycompai/auth` from files that end up in the Trigger.dev
 * bundle (that package pulls in better-auth, which the deploy pipeline can't
 * bundle — see policy-acknowledgment-digest-helpers.ts for the same pattern).
 * Keeping this rule free of imports lets both RSC/server code and Trigger.dev
 * tasks share one implementation. KEEP IN SYNC with the auth package version.
 *
 * Platform admins (`User.role === 'admin'`) are Comp AI staff embedded in
 * customer orgs for support; they are excluded from an org's business logic
 * UNLESS the org is internal (platform-operated, e.g. Comp AI's own org). MSP
 * staff (`User.role === 'msp_staff'`) follow the same participation rule.
 */
export const PLATFORM_ADMIN_ROLE = 'admin';

/** Global role for MSP technicians. Never grants platform-admin privileges. */
export const MSP_STAFF_ROLE = 'msp_staff';

/** Global `User.role` values excluded from customer-org participation. */
export const NON_PARTICIPANT_ROLES: readonly string[] = [
  PLATFORM_ADMIN_ROLE,
  MSP_STAFF_ROLE,
];

export function isNonParticipantRole(
  userRole: string | null | undefined,
): boolean {
  if (!userRole) return false;
  return NON_PARTICIPANT_ROLES.includes(userRole);
}

export function isOrgParticipant(
  userRole: string | null | undefined,
  { orgIsInternal }: { orgIsInternal: boolean },
): boolean {
  if (orgIsInternal) return true;
  return !isNonParticipantRole(userRole);
}

/**
 * Prisma `Member` where-fragment keeping only org participants (SQL translation
 * of {@link isOrgParticipant}). Empty for internal orgs. Null global roles are
 * included explicitly because `notIn` skips NULL in SQL. Wrapped in `AND` so it
 * is safe to spread next to a caller-supplied `user` filter.
 */
export function orgParticipantMemberWhereForFlag(orgIsInternal: boolean) {
  if (orgIsInternal) return {};
  return {
    AND: [
      {
        user: {
          OR: [{ role: { notIn: [...NON_PARTICIPANT_ROLES] } }, { role: null }],
        },
      },
    ],
  };
}
