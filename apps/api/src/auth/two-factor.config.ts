import type { BetterAuthPlugin } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { deleteSessionCookie } from 'better-auth/cookies';
import { generateRandomString } from 'better-auth/crypto';
import { twoFactor } from 'better-auth/plugins/two-factor';

/**
 * MFA (S6): better-auth `twoFactor` plugin (TOTP + backup codes) plus a
 * sign-in challenge for the sign-in methods this product actually uses.
 *
 * better-auth's twoFactor only intercepts /sign-in/email|username|phone-number.
 * We sign in with magic link, email OTP and OAuth, so `mfaSignInChallenge`
 * applies the same pending-2FA flow to those: it deletes the freshly created
 * session, sets the plugin's signed `two_factor` cookie + verification rows
 * (same format the plugin's verify endpoints consume), and then
 *   - JSON flows (email OTP)      → `{ twoFactorRedirect: true }` (handled by
 *     twoFactorClient's onTwoFactorRedirect)
 *   - redirect flows (magic link, OAuth callback) → 302 to the app's
 *     /auth/two-factor page, carrying the original destination.
 */

const TWO_FACTOR_COOKIE_NAME = 'two_factor';
const TWO_FACTOR_COOKIE_MAX_AGE_SECONDS = 600;
const JSON_SIGN_IN_PATHS = new Set(['/sign-in/email-otp']);
const REDIRECT_SIGN_IN_PATHS = new Set(['/magic-link/verify']);

export const twoFactorPlugin = () =>
  twoFactor({
    issuer: 'Comp AI',
    // Accounts are passwordless (magic link / OTP / OAuth), so enabling 2FA
    // is authorized by the session. Disable additionally requires a fresh
    // session (better-auth sensitiveSessionMiddleware).
    allowPasswordless: true,
  });

export function isRedirectSignInPath(path: string): boolean {
  return REDIRECT_SIGN_IN_PATHS.has(path) || path.startsWith('/callback/');
}

export function isChallengedSignInPath(path: string): boolean {
  return JSON_SIGN_IN_PATHS.has(path) || isRedirectSignInPath(path);
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

/** Location of the redirect the sign-in endpoint was about to send, if any. */
function originalLocation(returned: unknown): string | undefined {
  if (typeof returned !== 'object' || returned === null) return undefined;
  const headers = (returned as { headers?: unknown }).headers;
  if (typeof headers !== 'object' || headers === null) return undefined;
  try {
    return new Headers(headers as HeadersInit).get('location') ?? undefined;
  } catch {
    return undefined;
  }
}

export function buildTwoFactorPageUrl(redirectTo: string | undefined): string {
  const url = new URL('/auth/two-factor', appBaseUrl());
  if (redirectTo) url.searchParams.set('redirectTo', redirectTo);
  return url.toString();
}

export const mfaSignInChallenge = (): BetterAuthPlugin => ({
  id: 'mfa-sign-in-challenge',
  hooks: {
    after: [
      {
        matcher: (context) => isChallengedSignInPath(context.path ?? ''),
        handler: createAuthMiddleware(async (ctx) => {
          const data = ctx.context.newSession;
          if (!data?.user?.twoFactorEnabled) return;

          deleteSessionCookie(ctx, true);
          await ctx.context.internalAdapter.deleteSession(data.session.token);
          ctx.context.setNewSession(null);

          const expiresAt = new Date(
            Date.now() + TWO_FACTOR_COOKIE_MAX_AGE_SECONDS * 1000,
          );
          const identifier = `2fa-${generateRandomString(20)}`;
          await ctx.context.internalAdapter.createVerificationValue({
            value: data.user.id,
            identifier,
            expiresAt,
          });
          await ctx.context.internalAdapter.createVerificationValue({
            value: '0',
            identifier: `2fa-attempts-${identifier}`,
            expiresAt,
          });
          const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME, {
            maxAge: TWO_FACTOR_COOKIE_MAX_AGE_SECONDS,
          });
          await ctx.setSignedCookie(
            cookie.name,
            identifier,
            ctx.context.secret,
            cookie.attributes,
          );

          if (isRedirectSignInPath(ctx.path)) {
            return ctx.redirect(
              buildTwoFactorPageUrl(originalLocation(ctx.context.returned)),
            );
          }
          return ctx.json({
            twoFactorRedirect: true,
            twoFactorMethods: ['totp'],
          });
        }),
      },
    ],
  },
});
