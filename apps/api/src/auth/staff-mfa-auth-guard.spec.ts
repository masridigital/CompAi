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

import { getSessionFromCtx } from 'better-auth/api';
import {
  isStaffMfaProtectedPath,
  staffMfaAuthGuard,
} from './staff-mfa-auth-guard';

const mockedGetSession = getSessionFromCtx as jest.Mock;
type Hook = (ctx: unknown) => Promise<void>;

function getHook() {
  const hooks = staffMfaAuthGuard().hooks?.before ?? [];
  expect(hooks).toHaveLength(1);
  return {
    matcher: hooks[0].matcher as (ctx: {
      path?: string;
      method?: string;
    }) => boolean,
    handler: hooks[0].handler as unknown as Hook,
  };
}

function sessionFor(role: string, twoFactorEnabled: boolean) {
  return { user: { id: 'usr_1', role, twoFactorEnabled }, session: {} };
}

describe('staff MFA guard for better-auth endpoints (S6)', () => {
  const originalFlag = process.env.REQUIRE_MFA_FOR_STAFF;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.REQUIRE_MFA_FOR_STAFF;
  });

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.REQUIRE_MFA_FOR_STAFF;
    else process.env.REQUIRE_MFA_FOR_STAFF = originalFlag;
  });

  it.each([
    ['/admin/impersonate-user', 'POST'],
    ['/admin/set-role', 'POST'],
    ['/admin/ban-user', 'POST'],
    ['/admin/list-users', 'GET'],
    ['/organization/update-member-role', 'POST'],
    ['/organization/invite-member', 'POST'],
    ['/organization/delete', 'POST'],
    ['/organization/remove-member', 'POST'],
  ])('protects %s (%s)', (path, method) => {
    expect(isStaffMfaProtectedPath({ path, method })).toBe(true);
  });

  it.each([
    ['/two-factor/enable', 'POST'],
    ['/two-factor/verify-totp', 'POST'],
    ['/sign-out', 'POST'],
    ['/get-session', 'GET'],
    ['/admin/stop-impersonating', 'POST'],
    ['/organization/list', 'GET'],
    ['/organization/get-full-organization', 'GET'],
    ['/organization/set-active', 'POST'],
    ['/organization/check-slug', 'POST'],
  ])('does not protect %s (%s)', (path, method) => {
    expect(isStaffMfaProtectedPath({ path, method })).toBe(false);
  });

  it('matches on path and method', () => {
    const { matcher } = getHook();
    expect(matcher({ path: '/admin/set-role', method: 'POST' })).toBe(true);
    expect(matcher({ path: '/two-factor/enable', method: 'POST' })).toBe(false);
  });

  it.each(['admin', 'msp_staff', 'user,admin'])(
    'rejects un-enrolled %s with 403 MFA_REQUIRED',
    async (role) => {
      mockedGetSession.mockResolvedValue(sessionFor(role, false));
      const { handler } = getHook();
      await expect(handler({ path: '/admin/set-role' })).rejects.toMatchObject({
        status: 'FORBIDDEN',
        body: { code: 'MFA_REQUIRED' },
      });
    },
  );

  it('lets enrolled staff through', async () => {
    mockedGetSession.mockResolvedValue(sessionFor('admin', true));
    const { handler } = getHook();
    await expect(
      handler({ path: '/admin/impersonate-user' }),
    ).resolves.toBeUndefined();
  });

  it('lets non-staff through (better-auth applies its own permissions)', async () => {
    mockedGetSession.mockResolvedValue(sessionFor('user', false));
    const { handler } = getHook();
    await expect(
      handler({ path: '/organization/invite-member' }),
    ).resolves.toBeUndefined();
  });

  it('is a no-op when REQUIRE_MFA_FOR_STAFF=false', async () => {
    process.env.REQUIRE_MFA_FOR_STAFF = 'false';
    mockedGetSession.mockResolvedValue(sessionFor('admin', false));
    const { handler } = getHook();
    await expect(handler({ path: '/admin/set-role' })).resolves.toBeUndefined();
  });

  it('defers to the endpoint when there is no session', async () => {
    mockedGetSession.mockResolvedValue(null);
    const { handler } = getHook();
    await expect(handler({ path: '/admin/set-role' })).resolves.toBeUndefined();
  });
});
