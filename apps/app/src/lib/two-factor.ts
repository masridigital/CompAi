import { z } from 'zod';

/** Where staff without 2FA are sent (and where users manage 2FA). */
export const TWO_FACTOR_SETUP_PATH = '/account/two-factor';
/** Sign-in challenge page (reached with only the `two_factor` cookie). */
export const TWO_FACTOR_CHALLENGE_PATH = '/auth/two-factor';
export const MFA_REQUIRED_CODE = 'MFA_REQUIRED';

export const totpCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
});
export type TotpCodeValues = z.infer<typeof totpCodeSchema>;

export const backupCodeSchema = z.object({
  code: z.string().trim().min(6, 'Enter one of your backup codes'),
});
export type BackupCodeValues = z.infer<typeof backupCodeSchema>;

export const disableTwoFactorSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('totp'), code: totpCodeSchema.shape.code }),
  z.object({ method: z.literal('backup'), code: backupCodeSchema.shape.code }),
]);
export type DisableTwoFactorValues = z.infer<typeof disableTwoFactorSchema>;

/** True when an API error body is the staff-MFA 403. */
export function isMfaRequiredBody(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { code?: unknown }).code === MFA_REQUIRED_CODE
  );
}

/** Extract the base32 secret from an otpauth:// URI for manual entry. */
export function secretFromTotpUri(uri: string): string | null {
  try {
    return new URL(uri).searchParams.get('secret');
  } catch {
    return null;
  }
}

/**
 * Resolve the post-verification destination. Accepts a relative path, or an
 * absolute URL on this app's origin or the employee portal's origin. Anything
 * else falls back to "/" (no open redirect).
 */
export function resolvePostTwoFactorRedirect({
  redirectTo,
  appOrigin,
  portalUrl,
}: {
  redirectTo: string | null | undefined;
  appOrigin: string;
  portalUrl?: string | null;
}): string {
  if (!redirectTo) return '/';
  if (redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
    return redirectTo.split('?')[0].includes('://') ? '/' : redirectTo;
  }
  let target: URL;
  try {
    target = new URL(redirectTo);
  } catch {
    return '/';
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return '/';
  if (target.origin === appOrigin) {
    return `${target.pathname}${target.search}${target.hash}`;
  }
  if (portalUrl && safeOrigin(portalUrl) === target.origin) {
    return target.toString();
  }
  return '/';
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
