jest.mock('better-auth/crypto', () => ({
  symmetricEncrypt: jest.fn(async ({ data }: { data: string }) => `enc:${data}`),
}));

import {
  DISABLE_LOCKOUT_DURATION_MS,
  consumeBackupCode,
  isLocked,
  recordDisableFailure,
} from './two-factor-lockout';

const ROW = { id: 'tf_1', secret: 's', backupCodes: 'enc:["a","b"]' };

function makeAdapter({ count = 1, updated = 1 } = {}) {
  return {
    updateMany: jest.fn().mockResolvedValue(updated),
    incrementOne: jest
      .fn()
      .mockResolvedValue({ failedVerificationCount: count }),
  };
}

describe('two-factor lockout', () => {
  const NOW = 1_700_000_000_000;

  it('is locked only while lockedUntil is in the future', () => {
    expect(isLocked({ row: { lockedUntil: null }, now: NOW })).toBe(false);
    expect(
      isLocked({ row: { lockedUntil: new Date(NOW + 1) }, now: NOW }),
    ).toBe(true);
    expect(
      isLocked({ row: { lockedUntil: new Date(NOW - 1) }, now: NOW }),
    ).toBe(false);
  });

  it('increments without locking below the threshold', async () => {
    const adapter = makeAdapter({ count: 4 });
    await recordDisableFailure({ adapter, row: ROW, now: NOW });
    expect(adapter.incrementOne).toHaveBeenCalledTimes(1);
    expect(adapter.updateMany).not.toHaveBeenCalled();
  });

  it('locks for 15 minutes at 5 failures', async () => {
    const adapter = makeAdapter({ count: 5 });
    await recordDisableFailure({ adapter, row: ROW, now: NOW });
    expect(adapter.updateMany).toHaveBeenCalledWith({
      model: 'twoFactor',
      where: [{ field: 'id', value: 'tf_1' }],
      update: { lockedUntil: new Date(NOW + DISABLE_LOCKOUT_DURATION_MS) },
    });
    expect(DISABLE_LOCKOUT_DURATION_MS).toBe(15 * 60 * 1000);
  });

  it('restarts the budget after an expired lock', async () => {
    const adapter = makeAdapter({ count: 1 });
    await recordDisableFailure({
      adapter,
      row: {
        ...ROW,
        lockedUntil: new Date(NOW - 1000),
        failedVerificationCount: 5,
      },
      now: NOW,
    });
    expect(adapter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { failedVerificationCount: 0, lockedUntil: null },
      }),
    );
  });

  it('consumes a backup code only when the stored list is unchanged', async () => {
    const adapter = makeAdapter({ updated: 1 });
    await expect(
      consumeBackupCode({
        adapter,
        row: ROW,
        codes: ['a', 'b'],
        code: 'a',
        key: 'k',
      }),
    ).resolves.toBe(true);
    expect(adapter.updateMany).toHaveBeenCalledWith({
      model: 'twoFactor',
      where: [
        { field: 'id', value: 'tf_1' },
        { field: 'backupCodes', value: ROW.backupCodes },
      ],
      update: { backupCodes: 'enc:["b"]' },
    });

    const raced = makeAdapter({ updated: 0 });
    await expect(
      consumeBackupCode({
        adapter: raced,
        row: ROW,
        codes: ['a', 'b'],
        code: 'a',
        key: 'k',
      }),
    ).resolves.toBe(false);
  });
});
