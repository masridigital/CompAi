jest.mock('better-auth/plugins/two-factor', () => ({
  twoFactor: (options: unknown) => ({ id: 'two-factor', options }),
}));
jest.mock('better-auth/api', () => ({
  createAuthMiddleware: (handler: unknown) => handler,
}));
jest.mock('better-auth/cookies', () => ({ deleteSessionCookie: jest.fn() }));
jest.mock('better-auth/crypto', () => ({
  generateRandomString: () => 'random',
}));

import {
  buildTwoFactorPageUrl,
  isChallengeExemptPath,
  isRedirectFlow,
  mfaSignInChallenge,
  shouldChallengeNewSession,
  twoFactorPlugin,
} from './two-factor.config';

const MFA_USER = { id: 'usr_victim', twoFactorEnabled: true };
const newSessionFor = (
  user: { id: string; twoFactorEnabled?: boolean },
  session: Record<string, unknown> = {},
) => ({ user, session: { token: 'tok_new', ...session } });

type Handler = (ctx: unknown) => Promise<unknown>;

function getHook() {
  const hooks = mfaSignInChallenge().hooks?.after ?? [];
  expect(hooks).toHaveLength(1);
  return {
    matcher: hooks[0].matcher as (ctx: { path?: string }) => boolean,
    handler: hooks[0].handler as unknown as Handler,
  };
}

function makeCtx({
  path,
  method = 'POST',
  newSession,
  priorSession = null,
  returned,
}: {
  path: string;
  method?: string;
  newSession: unknown;
  priorSession?: unknown;
  returned?: unknown;
}) {
  const internalAdapter = {
    deleteSession: jest.fn(),
    createVerificationValue: jest.fn(),
  };
  return {
    path,
    method,
    context: {
      newSession,
      session: priorSession,
      returned,
      secret: 's',
      internalAdapter,
      setNewSession: jest.fn(),
      createAuthCookie: () => ({ name: 'two_factor', attributes: {} }),
    },
    setSignedCookie: jest.fn(),
    redirect: jest.fn((url: string) => ({ redirectedTo: url })),
    json: jest.fn((body: unknown) => body),
  };
}

describe('two-factor config (S6)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://compliance.masri.tech/';
  });

  it('configures passwordless TOTP 2FA with a Comp AI issuer', () => {
    expect(twoFactorPlugin()).toEqual({
      id: 'two-factor',
      options: { issuer: 'Comp AI', allowPasswordless: true },
    });
  });

  it('exempts only the 2FA verification and multi-session endpoints', () => {
    expect(isChallengeExemptPath('/two-factor/verify-totp')).toBe(true);
    expect(isChallengeExemptPath('/two-factor/verify-backup-code')).toBe(true);
    expect(isChallengeExemptPath('/multi-session/set-active')).toBe(true);
    expect(isChallengeExemptPath('/sign-in/social')).toBe(false);
    expect(isChallengeExemptPath('/magic-link/verify')).toBe(false);
  });

  it.each([
    '/sign-in/social',
    '/sign-in/email-otp',
    '/magic-link/verify',
    '/callback/:id',
    '/verify-email',
    '/some-future/sign-in',
  ])('challenges a fresh session for a 2FA user from %s', (path) => {
    expect(
      shouldChallengeNewSession({
        path,
        newSession: newSessionFor(MFA_USER),
        priorSession: null,
      }),
    ).toBe(true);
  });

  it('does not challenge users without 2FA or requests without a new session', () => {
    expect(
      shouldChallengeNewSession({
        path: '/sign-in/social',
        newSession: newSessionFor({ id: 'u', twoFactorEnabled: false }),
        priorSession: null,
      }),
    ).toBe(false);
    expect(
      shouldChallengeNewSession({
        path: '/sign-in/social',
        newSession: null,
        priorSession: null,
      }),
    ).toBe(false);
  });

  it('does not re-challenge sessions re-issued for an already signed-in user', () => {
    for (const path of ['/get-session', '/organization/set-active', '/update-user']) {
      expect(
        shouldChallengeNewSession({
          path,
          newSession: newSessionFor(MFA_USER),
          priorSession: newSessionFor(MFA_USER),
        }),
      ).toBe(false);
    }
  });

  it('challenges when an attacker with their own session signs in as someone else', () => {
    expect(
      shouldChallengeNewSession({
        path: '/sign-in/social',
        newSession: newSessionFor(MFA_USER),
        priorSession: newSessionFor({ id: 'usr_attacker' }),
      }),
    ).toBe(true);
  });

  it('allows admin impersonation start and stop hand-offs', () => {
    const admin = { id: 'usr_admin', twoFactorEnabled: true };
    expect(
      shouldChallengeNewSession({
        path: '/admin/impersonate-user',
        newSession: newSessionFor(MFA_USER, { impersonatedBy: 'usr_admin' }),
        priorSession: newSessionFor(admin),
      }),
    ).toBe(false);
    expect(
      shouldChallengeNewSession({
        path: '/admin/stop-impersonating',
        newSession: newSessionFor(admin),
        priorSession: newSessionFor(MFA_USER, { impersonatedBy: 'usr_admin' }),
      }),
    ).toBe(false);
  });

  it('detects redirect flows by path, Location header or GET', () => {
    expect(
      isRedirectFlow({ path: '/magic-link/verify', method: 'GET', returned: undefined }),
    ).toBe(true);
    expect(
      isRedirectFlow({
        path: '/verify-email',
        method: 'POST',
        returned: { headers: { location: 'https://x.test/' } },
      }),
    ).toBe(true);
    expect(
      isRedirectFlow({ path: '/sign-in/social', method: 'POST', returned: { redirect: false } }),
    ).toBe(false);
  });

  it('builds the app verify page URL with the original destination', () => {
    expect(buildTwoFactorPageUrl('https://compliance.masri.tech/org_1')).toBe(
      'https://compliance.masri.tech/auth/two-factor?redirectTo=https%3A%2F%2Fcompliance.masri.tech%2Forg_1',
    );
    expect(buildTwoFactorPageUrl(undefined)).toBe(
      'https://compliance.masri.tech/auth/two-factor',
    );
  });

  it('matches every path except the exempt ones', () => {
    const { matcher } = getHook();
    expect(matcher({ path: '/sign-in/social' })).toBe(true);
    expect(matcher({ path: '/magic-link/verify' })).toBe(true);
    expect(matcher({ path: '/two-factor/verify-totp' })).toBe(false);
  });

  it('challenges POST /sign-in/social with an idToken (JSON flow)', async () => {
    const { handler } = getHook();
    const ctx = makeCtx({
      path: '/sign-in/social',
      newSession: newSessionFor(MFA_USER),
      returned: { redirect: false, token: 'tok_new' },
    });
    const result = await handler(ctx);
    expect(ctx.context.internalAdapter.deleteSession).toHaveBeenCalledWith('tok_new');
    expect(ctx.context.setNewSession).toHaveBeenCalledWith(null);
    expect(ctx.setSignedCookie).toHaveBeenCalledWith(
      'two_factor',
      '2fa-random',
      's',
      {},
    );
    expect(result).toEqual({ twoFactorRedirect: true, twoFactorMethods: ['totp'] });
  });

  it.each(['/magic-link/verify', '/callback/:id'])(
    'challenges %s with a redirect to the verify page',
    async (path) => {
      const { handler } = getHook();
      const ctx = makeCtx({
        path,
        method: 'GET',
        newSession: newSessionFor(MFA_USER),
        returned: { headers: { location: 'https://compliance.masri.tech/org_1' } },
      });
      await handler(ctx);
      expect(ctx.redirect).toHaveBeenCalledWith(
        'https://compliance.masri.tech/auth/two-factor?redirectTo=https%3A%2F%2Fcompliance.masri.tech%2Forg_1',
      );
    },
  );

  it('challenges email OTP sign-in with the JSON flow', async () => {
    const { handler } = getHook();
    const ctx = makeCtx({
      path: '/sign-in/email-otp',
      newSession: newSessionFor(MFA_USER),
    });
    await expect(handler(ctx)).resolves.toEqual(
      expect.objectContaining({ twoFactorRedirect: true }),
    );
  });

  it('leaves the verify-totp session alone (would otherwise loop)', async () => {
    const { handler } = getHook();
    const ctx = makeCtx({
      path: '/two-factor/verify-totp',
      newSession: newSessionFor(MFA_USER),
    });
    await expect(handler(ctx)).resolves.toBeUndefined();
    expect(ctx.context.internalAdapter.deleteSession).not.toHaveBeenCalled();
  });
});
