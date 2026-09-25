const mockVerify = jest.fn();
jest.mock('@better-auth/utils/otp', () => ({
  createOTP: () => ({ verify: (code: string) => mockVerify(code) }),
}));
jest.mock('better-auth/api', () => ({
  APIError: class extends Error {
    constructor(
      public status: string,
      public body: { code: string; message: string },
    ) {
      super(body.message);
    }
  },
  createAuthMiddleware: (handler: unknown) => handler,
  getSessionFromCtx: jest.fn(),
}));
jest.mock('better-auth/crypto', () => ({
  // "Encryption" is a visible prefix so tests can read the stored value.
  symmetricDecrypt: jest.fn(async ({ data }: { data: string }) =>
    data.replace(/^enc:/, ''),
  ),
  symmetricEncrypt: jest.fn(
    async ({ data }: { data: string }) => `enc:${data}`,
  ),
}));

import { getSessionFromCtx } from 'better-auth/api';
import { twoFactorDisableGuard } from './two-factor-disable-guard';

type Hook = (ctx: unknown) => Promise<void>;
const hook = twoFactorDisableGuard().hooks?.before?.[0]
  .handler as unknown as Hook;
const mockedGetSession = getSessionFromCtx as jest.Mock;

const CODES = ['aaaa-1111', 'bbbb-2222'];
const ROW = {
  id: 'tf_1',
  secret: 'enc:SECRET',
  backupCodes: `enc:${JSON.stringify(CODES)}`,
  failedVerificationCount: 0,
  lockedUntil: null as Date | null,
};

function makeCtx({
  body,
  row = ROW,
  updateManyResult = 1,
  failedCount = 1,
}: {
  body: unknown;
  row?: typeof ROW | null;
  updateManyResult?: number;
  failedCount?: number;
}) {
  const adapter = {
    findOne: jest.fn().mockResolvedValue(row),
    updateMany: jest.fn().mockResolvedValue(updateManyResult),
    incrementOne: jest
      .fn()
      .mockResolvedValue({ failedVerificationCount: failedCount }),
  };
  return { body, context: { adapter, secretConfig: 'key' } };
}

describe('two-factor disable guard hook: backup codes + lockout', () => {
  const originalFlag = process.env.REQUIRE_MFA_FOR_STAFF;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.REQUIRE_MFA_FOR_STAFF;
    mockVerify.mockImplementation(async (code: string) => code === '123456');
    mockedGetSession.mockResolvedValue({
      user: { id: 'usr_1', role: 'user' },
    });
  });

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.REQUIRE_MFA_FOR_STAFF;
    else process.env.REQUIRE_MFA_FOR_STAFF = originalFlag;
  });

  it('consumes the backup code with a compare-and-swap, then resets failures', async () => {
    const ctx = makeCtx({ body: { backupCode: 'aaaa-1111' } });
    await expect(hook(ctx)).resolves.toBeUndefined();
    const [consume, reset] = ctx.context.adapter.updateMany.mock.calls;
    expect(consume[0]).toEqual({
      model: 'twoFactor',
      where: [
        { field: 'id', value: 'tf_1' },
        { field: 'backupCodes', value: ROW.backupCodes },
      ],
      update: { backupCodes: 'enc:["bbbb-2222"]' },
    });
    expect(reset[0].update).toEqual({
      failedVerificationCount: 0,
      lockedUntil: null,
    });
  });

  it('rejects a backup code a concurrent request already spent', async () => {
    const ctx = makeCtx({
      body: { backupCode: 'aaaa-1111' },
      updateManyResult: 0,
    });
    await expect(hook(ctx)).rejects.toMatchObject({
      body: { code: 'INVALID_SECOND_FACTOR' },
    });
    expect(ctx.context.adapter.incrementOne).toHaveBeenCalled();
  });

  it('accepts a valid TOTP code without touching backup codes', async () => {
    const ctx = makeCtx({ body: { code: '123456' } });
    await expect(hook(ctx)).resolves.toBeUndefined();
    expect(ctx.context.adapter.updateMany).toHaveBeenCalledTimes(1);
    expect(ctx.context.adapter.incrementOne).not.toHaveBeenCalled();
  });

  it('counts a wrong code toward the lockout', async () => {
    const ctx = makeCtx({ body: { code: '000000' } });
    await expect(hook(ctx)).rejects.toMatchObject({
      status: 'BAD_REQUEST',
      body: { code: 'INVALID_SECOND_FACTOR' },
    });
    expect(ctx.context.adapter.incrementOne).toHaveBeenCalledWith({
      model: 'twoFactor',
      where: [{ field: 'id', value: 'tf_1' }],
      increment: { failedVerificationCount: 1 },
    });
    expect(ctx.context.adapter.updateMany).not.toHaveBeenCalled();
  });

  it('locks the account on the 5th failure', async () => {
    const ctx = makeCtx({ body: { backupCode: 'zzzz-0000' }, failedCount: 5 });
    await expect(hook(ctx)).rejects.toBeDefined();
    expect(ctx.context.adapter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ update: { lockedUntil: expect.any(Date) } }),
    );
  });

  it('refuses even a valid code while locked, without counting it', async () => {
    const ctx = makeCtx({
      body: { code: '123456' },
      row: { ...ROW, lockedUntil: new Date(Date.now() + 60_000) },
    });
    await expect(hook(ctx)).rejects.toMatchObject({
      status: 'TOO_MANY_REQUESTS',
    });
    expect(ctx.context.adapter.incrementOne).not.toHaveBeenCalled();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('does not count a missing second factor as a failed attempt', async () => {
    const ctx = makeCtx({ body: {} });
    await expect(hook(ctx)).rejects.toMatchObject({
      body: { code: 'SECOND_FACTOR_REQUIRED' },
    });
    expect(ctx.context.adapter.incrementOne).not.toHaveBeenCalled();
  });
});
