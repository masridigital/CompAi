import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeyService } from './api-key.service';
import { HybridAuthGuard } from './hybrid-auth.guard';

const mockGetSession = jest.fn();
jest.mock('./auth.server', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      getMcpSession: jest.fn().mockResolvedValue(null),
    },
  },
}));

const mockMemberFindFirst = jest.fn();
jest.mock('@db', () => ({
  db: {
    member: {
      findFirst: (...args: unknown[]) => mockMemberFindFirst(...args),
    },
  },
}));

jest.mock('@trycompai/auth', () => ({ BUILT_IN_ROLE_PERMISSIONS: {} }));

interface SessionUser {
  role: string | null;
  twoFactorEnabled: boolean | null;
}

function createContext(url: string): ExecutionContext {
  const request = { headers: { cookie: 'session=abc' }, originalUrl: url };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

function givenSession(user: SessionUser) {
  mockGetSession.mockResolvedValue({
    user: { id: 'usr_1', email: 'staff@msp.test', ...user },
    session: { id: 'ses_1', activeOrganizationId: 'org_1' },
  });
}

async function outcome(url: string): Promise<'allowed' | 'MFA_REQUIRED' | 'other'> {
  try {
    await guard.canActivate(createContext(url));
    return 'allowed';
  } catch (error) {
    if (!(error instanceof ForbiddenException)) return 'other';
    const body = error.getResponse();
    return typeof body === 'object' && body !== null && 'code' in body
      ? 'MFA_REQUIRED'
      : 'other';
  }
}

let guard: HybridAuthGuard;

describe('HybridAuthGuard — staff MFA enforcement (S6)', () => {
  const originalFlag = process.env.REQUIRE_MFA_FOR_STAFF;

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.REQUIRE_MFA_FOR_STAFF;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridAuthGuard,
        {
          provide: ApiKeyService,
          useValue: { extractApiKey: jest.fn(), validateApiKey: jest.fn() },
        },
        Reflector,
      ],
    }).compile();
    guard = module.get(HybridAuthGuard);
    jest
      .spyOn(module.get(Reflector), 'getAllAndOverride')
      .mockReturnValue(false);
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_1',
      role: 'owner',
      department: 'it',
    });
  });

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.REQUIRE_MFA_FOR_STAFF;
    else process.env.REQUIRE_MFA_FOR_STAFF = originalFlag;
  });

  it.each([
    ['admin', false, 'MFA_REQUIRED'],
    ['admin', null, 'MFA_REQUIRED'],
    ['admin', true, 'allowed'],
    ['msp_staff', false, 'MFA_REQUIRED'],
    ['msp_staff', true, 'allowed'],
    ['user,admin', false, 'MFA_REQUIRED'],
    ['user', false, 'allowed'],
    [null, null, 'allowed'],
  ])(
    'role=%s twoFactorEnabled=%s on /v1/controls → %s',
    async (role, twoFactorEnabled, expected) => {
      givenSession({ role, twoFactorEnabled });
      await expect(outcome('/v1/controls')).resolves.toBe(expected);
    },
  );

  it.each(['/v1/auth/me', '/v1/auth/me?x=1', '/api/auth/two-factor/enable'])(
    'lets staff without 2FA reach allowlisted route %s',
    async (url) => {
      givenSession({ role: 'admin', twoFactorEnabled: false });
      await expect(outcome(url)).resolves.toBe('allowed');
    },
  );

  it('does not allowlist look-alike routes', async () => {
    givenSession({ role: 'admin', twoFactorEnabled: false });
    await expect(outcome('/v1/auth/invitations')).resolves.toBe('MFA_REQUIRED');
    await expect(outcome('/v1/auth/me/extra')).resolves.toBe('MFA_REQUIRED');
  });

  it('is disabled by REQUIRE_MFA_FOR_STAFF=false', async () => {
    process.env.REQUIRE_MFA_FOR_STAFF = 'false';
    givenSession({ role: 'msp_staff', twoFactorEnabled: false });
    await expect(outcome('/v1/controls')).resolves.toBe('allowed');
  });
});
