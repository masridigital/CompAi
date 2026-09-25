import type { BetterAuthPlugin } from 'better-auth';
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api';
import { MFA_REQUIRED_CODE, isMfaSetupRequired } from './mfa-policy';

/**
 * Staff MFA on better-auth's own endpoints (S6).
 *
 * HybridAuthGuard enforces REQUIRE_MFA_FOR_STAFF on /v1/*, but /api/auth/* is
 * allowlisted there so staff can reach the 2FA enrollment flow. That left
 * better-auth's privileged endpoints reachable by un-enrolled staff:
 * /admin/* (impersonate-user, set-role, ban-user, ...) and organization
 * mutations. This before-hook closes that gap. Enrollment (/two-factor/*),
 * sign-out and get-session are never matched, so setup still works.
 */

/** /admin/* endpoints that only ever reduce privilege. */
const ADMIN_ALWAYS_ALLOWED = new Set(['/admin/stop-impersonating']);

/**
 * Non-GET /organization/* endpoints that do not mutate organization data:
 * read-only POSTs and switching the session's active organization.
 */
const ORGANIZATION_NON_MUTATING = new Set([
  '/organization/set-active',
  '/organization/check-slug',
  '/organization/has-permission',
]);

export function isStaffMfaProtectedPath({
  path,
  method,
}: {
  path: string;
  method: string | undefined;
}): boolean {
  if (path.startsWith('/admin/')) return !ADMIN_ALWAYS_ALLOWED.has(path);
  if (!path.startsWith('/organization/')) return false;
  if ((method ?? 'POST').toUpperCase() === 'GET') return false;
  return !ORGANIZATION_NON_MUTATING.has(path);
}

export const staffMfaAuthGuard = (): BetterAuthPlugin => ({
  id: 'staff-mfa-auth-guard',
  hooks: {
    before: [
      {
        matcher: (context) =>
          isStaffMfaProtectedPath({
            path: context.path ?? '',
            method: context.method ?? context.request?.method,
          }),
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          // No session: the endpoint's own middleware rejects the request.
          if (!session) return;
          const user = session.user as {
            role?: string | null;
            twoFactorEnabled?: boolean | null;
          };
          if (
            !isMfaSetupRequired({
              role: user.role,
              twoFactorEnabled: user.twoFactorEnabled,
            })
          ) {
            return;
          }
          throw new APIError('FORBIDDEN', {
            code: MFA_REQUIRED_CODE,
            message:
              'Two-factor authentication is required for staff accounts. Set it up to continue.',
          });
        }),
      },
    ],
  },
});
