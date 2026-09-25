const mockVerify = jest.fn();
jest.mock('@better-auth/utils/otp', () => ({
  createOTP: () => ({ verify: (code: string) => mockVerify(code) }),
}));
jest.mock('better-auth/api', () => ({
  APIError: class extends Error {},
  createAuthMiddleware: (handler: unknown) => handler,
  getSessionFromCtx: jest.fn(),
}));
jest.mock('better-auth/crypto', () => ({ symmetricDecrypt: jest.fn() }));

import {
  DISABLE_PATH,
  decideDisable,
  twoFactorDisableGuard,
} from './two-factor-disable-guard';

const STORED = {
  secret: 'JBSWY3DPEHPK3PXP',
  backupCodes: ['aaaa-1111', 'bbbb-2222'],
};

describe('two-factor disable guard (S6)', () => {
  const originalFlag = process.env.REQUIRE_MFA_FOR_STAFF;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.REQUIRE_MFA_FOR_STAFF;
    mockVerify.mockImplementation(async (code: string) => code === '123456');
  });

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.REQUIRE_MFA_FOR_STAFF;
    else process.env.REQUIRE_MFA_FOR_STAFF = originalFlag;
  });

  it.each(['admin', 'msp_staff', 'user,admin'])(
    'refuses %s outright with MFA_REQUIRED, even with a valid code',
    async (role) => {
      await expect(
        decideDisable({ role, proof: { code: '123456' }, stored: STORED }),
      ).resolves.toEqual(
        expect.objectContaining({
          allowed: false,
          status: 'FORBIDDEN',
          code: 'MFA_REQUIRED',
        }),
      );
      expect(mockVerify).not.toHaveBeenCalled();
    },
  );

  it('lets staff disable when REQUIRE_MFA_FOR_STAFF=false (with a valid code)', async () => {
    process.env.REQUIRE_MFA_FOR_STAFF = 'false';
    await expect(
      decideDisable({
        role: 'admin',
        proof: { code: '123456' },
        stored: STORED,
      }),
    ).resolves.toEqual({ allowed: true });
  });

  it('requires a second factor: a recent session alone is not enough', async () => {
    await expect(
      decideDisable({ role: 'user', proof: {}, stored: STORED }),
    ).resolves.toEqual(
      expect.objectContaining({
        allowed: false,
        code: 'SECOND_FACTOR_REQUIRED',
      }),
    );
  });

  it('accepts a valid current TOTP code', async () => {
    await expect(
      decideDisable({
        role: 'user',
        proof: { code: '123456' },
        stored: STORED,
      }),
    ).resolves.toEqual({ allowed: true });
    expect(mockVerify).toHaveBeenCalledWith('123456');
  });

  it('rejects a wrong TOTP code', async () => {
    await expect(
      decideDisable({
        role: 'user',
        proof: { code: '000000' },
        stored: STORED,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        allowed: false,
        code: 'INVALID_SECOND_FACTOR',
      }),
    );
  });

  it('accepts an unused backup code and rejects an unknown one', async () => {
    await expect(
      decideDisable({
        role: null,
        proof: { backupCode: 'bbbb-2222' },
        stored: STORED,
      }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      decideDisable({
        role: null,
        proof: { backupCode: 'zzzz-9999' },
        stored: STORED,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        allowed: false,
        code: 'INVALID_SECOND_FACTOR',
      }),
    );
  });

  it('rejects when no 2FA record exists', async () => {
    await expect(
      decideDisable({ role: 'user', proof: { code: '123456' }, stored: null }),
    ).resolves.toEqual(
      expect.objectContaining({
        allowed: false,
        code: 'INVALID_SECOND_FACTOR',
      }),
    );
  });

  it('registers a before-hook on the disable endpoint only', () => {
    const hooks = twoFactorDisableGuard().hooks?.before ?? [];
    expect(hooks).toHaveLength(1);
    const matcher = hooks[0].matcher as (ctx: { path?: string }) => boolean;
    expect(matcher({ path: DISABLE_PATH })).toBe(true);
    expect(matcher({ path: '/two-factor/generate-backup-codes' })).toBe(false);
  });
});
