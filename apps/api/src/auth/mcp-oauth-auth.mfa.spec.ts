import { ForbiddenException, Logger } from '@nestjs/common';
import { authenticateMcpOAuth } from './mcp-oauth-auth';
import { AuthenticatedRequest } from './types';

const mockGetMcpSession = jest.fn();
jest.mock('./auth.server', () => ({
  auth: {
    api: { getMcpSession: (...args: unknown[]) => mockGetMcpSession(...args) },
  },
}));

const mockUserFindUnique = jest.fn();
const mockMemberFindMany = jest.fn();
jest.mock('@db', () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    member: { findMany: (...args: unknown[]) => mockMemberFindMany(...args) },
    mcpOrgBinding: { findUnique: jest.fn() },
  },
}));

jest.mock('./app-access', () => ({
  hasAppAccess: jest.fn().mockResolvedValue(true),
}));

const logger = { log: jest.fn() } as unknown as Logger;

function run(url = '/v1/controls') {
  const request = {
    headers: {},
    originalUrl: url,
  } as unknown as AuthenticatedRequest;
  return authenticateMcpOAuth({
    request,
    headers: new Headers({ authorization: 'Bearer mcp' }),
    logger,
  });
}

async function outcome(url?: string): Promise<string> {
  try {
    return (await run(url)) ? 'allowed' : 'rejected';
  } catch (error) {
    if (!(error instanceof ForbiddenException)) throw error;
    const body = error.getResponse() as { code?: string };
    return body.code ?? 'forbidden';
  }
}

describe('authenticateMcpOAuth — staff MFA enforcement (S6)', () => {
  const originalFlag = process.env.REQUIRE_MFA_FOR_STAFF;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.REQUIRE_MFA_FOR_STAFF;
    mockGetMcpSession.mockResolvedValue({ userId: 'usr_1' });
    mockMemberFindMany.mockResolvedValue([
      { id: 'mem_1', role: 'owner', department: 'it', organizationId: 'org_1' },
    ]);
  });

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.REQUIRE_MFA_FOR_STAFF;
    else process.env.REQUIRE_MFA_FOR_STAFF = originalFlag;
  });

  it.each([
    ['admin', false, 'MFA_REQUIRED'],
    ['msp_staff', null, 'MFA_REQUIRED'],
    ['admin', true, 'allowed'],
    ['msp_staff', true, 'allowed'],
    ['user', false, 'allowed'],
  ])(
    'role=%s twoFactorEnabled=%s → %s',
    async (role, twoFactorEnabled, expected) => {
      mockUserFindUnique.mockResolvedValue({
        id: 'usr_1',
        email: 'u@msp.test',
        role,
        twoFactorEnabled,
      });
      await expect(outcome()).resolves.toBe(expected);
    },
  );

  it('does not resolve memberships for a blocked staff user', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_1',
      email: 'u@msp.test',
      role: 'admin',
      twoFactorEnabled: false,
    });
    await outcome();
    expect(mockMemberFindMany).not.toHaveBeenCalled();
  });

  it('is disabled by REQUIRE_MFA_FOR_STAFF=false', async () => {
    process.env.REQUIRE_MFA_FOR_STAFF = 'false';
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_1',
      email: 'u@msp.test',
      role: 'admin',
      twoFactorEnabled: false,
    });
    await expect(outcome()).resolves.toBe('allowed');
  });
});
