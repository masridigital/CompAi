import { createOTP } from '@better-auth/utils/otp';
import type { BetterAuthPlugin } from 'better-auth';
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api';
import { symmetricDecrypt } from 'better-auth/crypto';
import {
  MFA_REQUIRED_CODE,
  isMfaEnforcementEnabled,
  roleRequiresMfa,
} from './mfa-policy';
import {
  type TwoFactorRow,
  consumeBackupCode,
  isLocked,
  recordDisableFailure,
  resetDisableFailures,
} from './two-factor-lockout';

/**
 * Hardening for POST /api/auth/two-factor/disable (S6).
 *
 * better-auth only requires a fresh session to disable 2FA. We additionally:
 *  - refuse outright for staff (admin / msp_staff) while
 *    REQUIRE_MFA_FOR_STAFF is on (403 MFA_REQUIRED) — they may only rotate
 *    backup codes;
 *  - require proof of the second factor: a current TOTP `code` or an unused
 *    `backupCode` in the request body. A backup code is consumed atomically
 *    (single use), and failed attempts count toward the same account lockout
 *    the twoFactor plugin uses (5 failures → locked for 15 minutes).
 */

export const DISABLE_PATH = '/two-factor/disable';
export const SECOND_FACTOR_REQUIRED_CODE = 'SECOND_FACTOR_REQUIRED';
export const INVALID_SECOND_FACTOR_CODE = 'INVALID_SECOND_FACTOR';
export const TWO_FACTOR_LOCKED_CODE = 'ACCOUNT_TEMPORARILY_LOCKED';

export interface DisableProof {
  code?: string;
  backupCode?: string;
}

export interface StoredTwoFactor {
  /** Decrypted base32 TOTP secret. */
  secret: string;
  /** Decrypted backup codes. */
  backupCodes: string[];
}

export type DisableDecision =
  | { allowed: true; backupCode?: string }
  | {
      allowed: false;
      status: 'FORBIDDEN' | 'BAD_REQUEST' | 'TOO_MANY_REQUESTS';
      code: string;
      message: string;
    };

function readProof(body: unknown): DisableProof {
  if (typeof body !== 'object' || body === null) return {};
  const { code, backupCode } = body as { code?: unknown; backupCode?: unknown };
  return {
    code: typeof code === 'string' && code.trim() ? code.trim() : undefined,
    backupCode:
      typeof backupCode === 'string' && backupCode.trim()
        ? backupCode.trim()
        : undefined,
  };
}

/** Pure decision logic, unit-tested without better-auth internals. */
export async function decideDisable({
  role,
  proof,
  stored,
  locked = false,
}: {
  role: string | null | undefined;
  proof: DisableProof;
  stored: StoredTwoFactor | null;
  /** Account is inside a failed-attempt lockout window. */
  locked?: boolean;
}): Promise<DisableDecision> {
  if (isMfaEnforcementEnabled() && roleRequiresMfa(role)) {
    return {
      allowed: false,
      status: 'FORBIDDEN',
      code: MFA_REQUIRED_CODE,
      message: 'Staff accounts cannot turn off two-factor authentication.',
    };
  }
  if (!proof.code && !proof.backupCode) {
    return {
      allowed: false,
      status: 'BAD_REQUEST',
      code: SECOND_FACTOR_REQUIRED_CODE,
      message:
        'Enter an authenticator code or a backup code to turn off two-factor authentication.',
    };
  }
  if (locked) {
    return {
      allowed: false,
      status: 'TOO_MANY_REQUESTS',
      code: TWO_FACTOR_LOCKED_CODE,
      message: 'Too many failed attempts. Try again in 15 minutes.',
    };
  }
  const invalid: DisableDecision = INVALID_DECISION;
  if (!stored) return invalid;
  if (proof.code) {
    const ok = await createOTP(stored.secret, { digits: 6, period: 30 }).verify(
      proof.code,
    );
    return ok ? { allowed: true } : invalid;
  }
  return proof.backupCode && stored.backupCodes.includes(proof.backupCode)
    ? { allowed: true, backupCode: proof.backupCode }
    : invalid;
}

const INVALID_DECISION = {
  allowed: false,
  status: 'BAD_REQUEST',
  code: INVALID_SECOND_FACTOR_CODE,
  message: 'Invalid authenticator or backup code.',
} as const;

function parseCodes(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((c): c is string => typeof c === 'string')
      : [];
  } catch {
    return [];
  }
}

export const twoFactorDisableGuard = (): BetterAuthPlugin => ({
  id: 'two-factor-disable-guard',
  hooks: {
    before: [
      {
        matcher: (context) => context.path === DISABLE_PATH,
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          // No session: let the endpoint's own session middleware reject it.
          if (!session) return;

          const adapter = ctx.context.adapter;
          const row = await adapter.findOne<TwoFactorRow>({
            model: 'twoFactor',
            where: [{ field: 'userId', value: session.user.id }],
          });
          const key = ctx.context.secretConfig;
          const stored: StoredTwoFactor | null = row
            ? {
                secret: await symmetricDecrypt({ key, data: row.secret }),
                backupCodes: parseCodes(
                  await symmetricDecrypt({ key, data: row.backupCodes }),
                ),
              }
            : null;

          const role = (session.user as { role?: string | null }).role;
          const decision = await decideDisable({
            role,
            proof: readProof(ctx.body),
            stored,
            locked: row ? isLocked({ row }) : false,
          });
          const reject = (d: Exclude<DisableDecision, { allowed: true }>) =>
            new APIError(d.status, { code: d.code, message: d.message });

          if (!decision.allowed) {
            if (row && decision.code === INVALID_SECOND_FACTOR_CODE) {
              await recordDisableFailure({ adapter, row });
            }
            throw reject(decision);
          }
          if (!row || !stored) return;
          if (decision.backupCode) {
            const consumed = await consumeBackupCode({
              adapter,
              row,
              codes: stored.backupCodes,
              code: decision.backupCode,
              key,
            });
            if (!consumed) {
              await recordDisableFailure({ adapter, row });
              throw reject(INVALID_DECISION);
            }
          }
          await resetDisableFailures({ adapter, row });
        }),
      },
    ],
  },
});
