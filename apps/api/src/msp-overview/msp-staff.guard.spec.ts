jest.mock('@trycompai/auth', () =>
  jest.requireActual('./msp-auth.test-fixture'),
);
import { ExecutionContext, ForbiddenException } from '@nestjs/common';

const mockUserFindUnique = jest.fn();
jest.mock('@db', () => ({
  db: { user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) } },
}));

import { isMfaAllowlistedPath, MFA_REQUIRED_CODE } from '../auth/mfa-policy';
import type { MspRequest } from './msp-scope';
import { MspStaffGuard } from './msp-staff.guard';

function ctx(overrides: Partial<MspRequest>): {
  context: ExecutionContext;
  request: Partial<MspRequest>;
} {
  const request: Partial<MspRequest> & { originalUrl: string } = {
    authType: 'session',
    isApiKey: false,
    isServiceToken: false,
    userId: 'usr_1',
    originalUrl: '/v1/msp/overview',
    ...overrides,
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('MspStaffGuard', () => {
  const guard = new MspStaffGuard();
  const originalEnv = process.env.REQUIRE_MFA_FOR_STAFF;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.REQUIRE_MFA_FOR_STAFF;
  });
  afterAll(() => {
    process.env.REQUIRE_MFA_FOR_STAFF = originalEnv;
  });

  it('rejects API keys, service tokens and MCP OAuth without a DB lookup', async () => {
    for (const overrides of [
      { authType: 'api-key' as const, isApiKey: true },
      { authType: 'service' as const, isServiceToken: true },
      { isMcpOAuth: true },
      { userId: undefined },
    ]) {
      await expect(guard.canActivate(ctx(overrides).context)).rejects.toThrow(
        ForbiddenException,
      );
    }
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('rejects ordinary users (403)', async () => {
    mockUserFindUnique.mockResolvedValue({
      role: 'user',
      twoFactorEnabled: true,
    });
    await expect(guard.canActivate(ctx({}).context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('requires 2FA for staff (MFA_REQUIRED)', async () => {
    mockUserFindUnique.mockResolvedValue({
      role: 'msp_staff',
      twoFactorEnabled: false,
    });
    await expect(guard.canActivate(ctx({}).context)).rejects.toMatchObject({
      response: expect.objectContaining({ code: MFA_REQUIRED_CODE }),
    });
  });

  it('allows msp_staff and admin with 2FA and records the role', async () => {
    mockUserFindUnique.mockResolvedValue({
      role: 'msp_staff',
      twoFactorEnabled: true,
    });
    const staff = ctx({});
    await expect(guard.canActivate(staff.context)).resolves.toBe(true);
    expect(staff.request.mspRole).toBe('msp_staff');

    mockUserFindUnique.mockResolvedValue({
      role: 'admin',
      twoFactorEnabled: true,
    });
    const admin = ctx({});
    await expect(guard.canActivate(admin.context)).resolves.toBe(true);
    expect(admin.request.mspRole).toBe('admin');
  });

  it('the /v1/msp routes are not on the staff MFA allowlist (HybridAuthGuard enforces MFA)', () => {
    expect(isMfaAllowlistedPath('/v1/msp/overview')).toBe(false);
    expect(isMfaAllowlistedPath('/v1/msp/tasks?view=overdue')).toBe(false);
  });
});
