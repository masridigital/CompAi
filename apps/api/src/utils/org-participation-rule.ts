/**
 * Pure, dependency-free org-participation rule.
 *
 * This is a deliberate mirror of `packages/auth/src/participation.ts`. Files
 * that end up in the API's Trigger.dev bundle (e.g. task notifiers) cannot
 * import `@trycompai/auth/participation`: the auth package's dist is not built
 * in the Trigger.dev deploy workflow, so esbuild fails to resolve the subpath
 * ("Could not resolve @trycompai/auth/participation"). Keeping this rule free of
 * imports lets both NestJS services and Trigger.dev tasks share one
 * implementation. KEEP IN SYNC with the auth package version — the drift-guard
 * test in `org-participation-rule.spec.ts` fails CI if they diverge.
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
