import { ForbiddenException } from '@nestjs/common';

/**
 * Staff MFA enforcement (S6).
 *
 * Users whose global User.role includes `admin` or `msp_staff` must have
 * 2FA enabled to use session auth on the API, except on an allowlist that
 * lets them reach the auth + 2FA setup flow. Controlled by
 * REQUIRE_MFA_FOR_STAFF (default true; set to "false" to disable).
 */

export const MFA_REQUIRED_CODE = 'MFA_REQUIRED';
export const MFA_ENFORCED_ROLES = ['admin', 'msp_staff'] as const;

/** Exact API paths (no query string) staff may call without 2FA. */
const MFA_ALLOWLIST_EXACT = new Set(['/v1/auth/me']);
/** Path prefixes staff may call without 2FA (better-auth incl. /two-factor/*). */
const MFA_ALLOWLIST_PREFIXES = ['/api/auth/'];

export function isMfaEnforcementEnabled(): boolean {
  return process.env.REQUIRE_MFA_FOR_STAFF !== 'false';
}

export function roleRequiresMfa(role: string | null | undefined): boolean {
  if (!role) return false;
  return role
    .split(',')
    .map((r) => r.trim())
    .some((r) => MFA_ENFORCED_ROLES.some((enforced) => enforced === r));
}

export function isMfaAllowlistedPath(rawPath: string | undefined): boolean {
  if (!rawPath) return false;
  const path = rawPath.split('?')[0].replace(/\/+$/, '') || '/';
  if (MFA_ALLOWLIST_EXACT.has(path)) return true;
  return MFA_ALLOWLIST_PREFIXES.some((prefix) => `${path}/`.startsWith(prefix));
}

/** True when this user must set up 2FA before using the API. */
export function isMfaSetupRequired({
  role,
  twoFactorEnabled,
}: {
  role: string | null | undefined;
  twoFactorEnabled: boolean | null | undefined;
}): boolean {
  return (
    isMfaEnforcementEnabled() &&
    roleRequiresMfa(role) &&
    twoFactorEnabled !== true
  );
}

export function mfaRequiredException(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    error: 'Forbidden',
    code: MFA_REQUIRED_CODE,
    message:
      'Two-factor authentication is required for staff accounts. Set it up to continue.',
  });
}

/** Throws 403 MFA_REQUIRED for staff without 2FA on non-allowlisted paths. */
export function assertStaffMfa({
  role,
  twoFactorEnabled,
  path,
}: {
  role: string | null | undefined;
  twoFactorEnabled: boolean | null | undefined;
  path: string | undefined;
}): void {
  if (!isMfaSetupRequired({ role, twoFactorEnabled })) return;
  if (isMfaAllowlistedPath(path)) return;
  throw mfaRequiredException();
}

/** Best-effort request path (Express `originalUrl`, falling back to `url`). */
export function requestPath(request: unknown): string | undefined {
  if (typeof request !== 'object' || request === null) return undefined;
  const { originalUrl, url } = request as {
    originalUrl?: unknown;
    url?: unknown;
  };
  if (typeof originalUrl === 'string') return originalUrl;
  return typeof url === 'string' ? url : undefined;
}
