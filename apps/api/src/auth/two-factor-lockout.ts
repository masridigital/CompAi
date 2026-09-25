import { symmetricEncrypt } from 'better-auth/crypto';

/**
 * Failed-attempt lockout and single-use backup codes for the 2FA disable
 * guard (S6).
 *
 * better-auth's own lockout helpers (assertTwoFactorNotLocked /
 * recordTwoFactorFailure) are internal to the twoFactor plugin and not
 * exported, so this mirrors them on the SAME columns
 * (`twoFactor.failedVerificationCount` / `twoFactor.lockedUntil`). The budget
 * is therefore shared with the plugin's verify endpoints: failures here count
 * toward sign-in lockout and vice versa, and a lock set here is honoured by
 * /two-factor/verify-*.
 */

export const DISABLE_MAX_FAILED_ATTEMPTS = 5;
export const DISABLE_LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const TWO_FACTOR_MODEL = 'twoFactor';

export interface TwoFactorRow {
  id: string;
  secret: string;
  backupCodes: string;
  failedVerificationCount?: number | null;
  lockedUntil?: Date | string | null;
}

type WhereClause = {
  field: string;
  value: string | number | boolean | Date | null;
  operator?: 'eq' | 'lte';
};

/** The subset of better-auth's DBAdapter the lockout needs. */
export interface LockoutAdapter {
  updateMany(data: {
    model: string;
    where: WhereClause[];
    update: Record<string, unknown>;
  }): Promise<number>;
  incrementOne<T>(data: {
    model: string;
    where: WhereClause[];
    increment: Record<string, number>;
  }): Promise<T | null>;
}

export function isLocked({
  row,
  now = Date.now(),
}: {
  row: Pick<TwoFactorRow, 'lockedUntil'>;
  now?: number;
}): boolean {
  if (!row.lockedUntil) return false;
  return new Date(row.lockedUntil).getTime() > now;
}

/**
 * Count one failed attempt (atomic increment) and lock the account for
 * DISABLE_LOCKOUT_DURATION_MS once DISABLE_MAX_FAILED_ATTEMPTS is reached.
 * An expired lock restarts the budget.
 */
export async function recordDisableFailure({
  adapter,
  row,
  now = Date.now(),
}: {
  adapter: LockoutAdapter;
  row: TwoFactorRow;
  now?: number;
}): Promise<void> {
  if (row.lockedUntil && !isLocked({ row, now })) {
    await adapter.updateMany({
      model: TWO_FACTOR_MODEL,
      where: [
        { field: 'id', value: row.id },
        { field: 'lockedUntil', operator: 'lte', value: new Date(now) },
      ],
      update: { failedVerificationCount: 0, lockedUntil: null },
    });
  }
  const updated = await adapter.incrementOne<{
    failedVerificationCount?: number | null;
  }>({
    model: TWO_FACTOR_MODEL,
    where: [{ field: 'id', value: row.id }],
    increment: { failedVerificationCount: 1 },
  });
  const count = updated?.failedVerificationCount ?? 0;
  if (count < DISABLE_MAX_FAILED_ATTEMPTS) return;
  await adapter.updateMany({
    model: TWO_FACTOR_MODEL,
    where: [{ field: 'id', value: row.id }],
    update: { lockedUntil: new Date(now + DISABLE_LOCKOUT_DURATION_MS) },
  });
}

export async function resetDisableFailures({
  adapter,
  row,
}: {
  adapter: LockoutAdapter;
  row: TwoFactorRow;
}): Promise<void> {
  await adapter.updateMany({
    model: TWO_FACTOR_MODEL,
    where: [{ field: 'id', value: row.id }],
    update: { failedVerificationCount: 0, lockedUntil: null },
  });
}

/**
 * Remove `code` from the stored backup codes with a compare-and-swap on the
 * encrypted column: the update only applies while the row still holds the
 * exact list we verified against, so two concurrent requests cannot both
 * spend the same code. Returns false when another request won the race.
 */
export async function consumeBackupCode({
  adapter,
  row,
  codes,
  code,
  key,
}: {
  adapter: LockoutAdapter;
  row: TwoFactorRow;
  codes: string[];
  code: string;
  key: Parameters<typeof symmetricEncrypt>[0]['key'];
}): Promise<boolean> {
  const remaining = codes.filter((c) => c !== code);
  const encrypted = await symmetricEncrypt({
    key,
    data: JSON.stringify(remaining),
  });
  const count = await adapter.updateMany({
    model: TWO_FACTOR_MODEL,
    where: [
      { field: 'id', value: row.id },
      { field: 'backupCodes', value: row.backupCodes },
    ],
    update: { backupCodes: encrypted },
  });
  return count === 1;
}
