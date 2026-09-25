import type { BetterAuthPlugin } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { deleteSessionCookie } from 'better-auth/cookies';
import { generateRandomString } from 'better-auth/crypto';
import { twoFactor } from 'better-auth/plugins/two-factor';

/**
 * MFA (S6): better-auth `twoFactor` plugin (TOTP + backup codes) plus a
 * sign-in challenge that covers EVERY way of obtaining a session.
 *
 * better-auth's twoFactor only intercepts /sign-in/email|username|phone-number.
 * `mfaSignInChallenge` is deliberately inverted: it runs after every endpoint
 * and challenges any request that produced a new session
 * (`ctx.context.newSession`) for a user with `twoFactorEnabled`, unless the
 * request was already authorized by an existing, fully authenticated session
 * (see `shouldChallengeNewSession`). That covers magic link, email OTP, OAuth
 * callbacks, `/sign-in/social` with an `idToken`, email-verification
 * auto sign-in, and any sign-in route a future plugin adds.
 *
 * A challenge deletes the freshly created session, sets the plugin's signed
 * `two_factor` cookie + verification rows (same format the plugin's verify
 * endpoints consume), and then
 *   - JSON flows    → `{ twoFactorRedirect: true }` (handled by
 *     twoFactorClient's onTwoFactorRedirect)
 *   - redirect flows (GET / 302) → 302 to the app's /auth/two-factor page,
 *     carrying the original destination.
 */

const TWO_FACTOR_COOKIE_NAME = 'two_factor';
const TWO_FACTOR_COOKIE_MAX_AGE_SECONDS = 600;
const REDIRECT_SIGN_IN_PATHS = new Set(['/magic-link/verify']);

/**
 * Paths whose new sessions are never challenged:
 *  - /two-factor/*   : the verification endpoints themselves (verify-totp,
 *    verify-backup-code, verify-otp) issue the post-2FA session; challenging
 *    them would loop forever. enable/disable also re-issue the session.
 *  - /multi-session/*: set-active only switches between sessions already held
 *    (and already 2FA-verified) on this device.
 */
const EXEMPT_PATH_PREFIXES = ['/two-factor/', '/multi-session/'];

export const twoFactorPlugin = () =>
  twoFactor({
    issuer: 'Comp AI',
    // Accounts are passwordless (magic link / OTP / OAuth), so enabling 2FA
    // is authorized by the session. Disable additionally requires a fresh
    // session (better-auth sensitiveSessionMiddleware).
    allowPasswordless: true,
  });

export function isChallengeExemptPath(path: string): boolean {
  return EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function isRedirectSignInPath(path: string): boolean {
  return REDIRECT_SIGN_IN_PATHS.has(path) || path.startsWith('/callback/');
}

interface SessionLike {
  session?: unknown;
  user?: unknown;
}

function readString(source: unknown, key: string): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value ? value : undefined;
}

function readTwoFactorEnabled(user: unknown): boolean {
  if (typeof user !== 'object' || user === null) return false;
  return (user as { twoFactorEnabled?: unknown }).twoFactorEnabled === true;
}

/**
 * Decides whether the session created by this request must be challenged.
 *
 * `priorSession` is `ctx.context.session`: the session that authenticated the
 * request (set by sessionMiddleware / adminMiddleware / get-session). A
 * request already carried by a full session for the SAME user (get-session
 * refresh, update-user, organization/set-active, ...) is not a new sign-in.
 * Admin impersonation start/stop is a hand-off between the admin's full
 * session and the impersonation session, so it is not challenged either.
 */
export function shouldChallengeNewSession({
  path,
  newSession,
  priorSession,
}: {
  path: string;
  newSession: SessionLike | null | undefined;
  priorSession: SessionLike | null | undefined;
}): boolean {
  if (!newSession || !readTwoFactorEnabled(newSession.user)) return false;
  if (isChallengeExemptPath(path)) return false;

  const newUserId = readString(newSession.user, 'id');
  const priorUserId = readString(priorSession?.user, 'id');
  if (!newUserId || !priorUserId) return true;
  if (priorUserId === newUserId) return false;
  // /admin/impersonate-user: new session was minted by the prior (admin) user.
  if (readString(newSession.session, 'impersonatedBy') === priorUserId) {
    return false;
  }
  // /admin/stop-impersonating: returning to the impersonating admin.
  return readString(priorSession?.session, 'impersonatedBy') !== newUserId;
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

/** Location of the redirect the endpoint was about to send, if any. */
export function originalLocation(returned: unknown): string | undefined {
  if (typeof returned !== 'object' || returned === null) return undefined;
  const headers = (returned as { headers?: unknown }).headers;
  if (typeof headers !== 'object' || headers === null) return undefined;
  try {
    return new Headers(headers as HeadersInit).get('location') ?? undefined;
  } catch {
    return undefined;
  }
}

/** Browser-navigation flows get a 302; XHR/JSON flows get a JSON body. */
export function isRedirectFlow({
  path,
  method,
  returned,
}: {
  path: string;
  method: string | undefined;
  returned: unknown;
}): boolean {
  if (isRedirectSignInPath(path)) return true;
  if (originalLocation(returned) !== undefined) return true;
  return (method ?? '').toUpperCase() === 'GET';
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
        matcher: (context) => !isChallengeExemptPath(context.path ?? ''),
        handler: createAuthMiddleware(async (ctx) => {
          const data = ctx.context.newSession;
          const challenge = shouldChallengeNewSession({
            path: ctx.path,
            newSession: data,
            priorSession: ctx.context.session,
          });
          if (!data || !challenge) return;

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

          const returned = ctx.context.returned;
          if (isRedirectFlow({ path: ctx.path, method: ctx.method, returned })) {
            return ctx.redirect(
              buildTwoFactorPageUrl(originalLocation(returned)),
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
