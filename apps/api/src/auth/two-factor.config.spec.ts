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
  isChallengedSignInPath,
  isRedirectSignInPath,
  mfaSignInChallenge,
  twoFactorPlugin,
} from './two-factor.config';

describe('two-factor config (S6)', () => {
  it('configures passwordless TOTP 2FA with a Comp AI issuer', () => {
    expect(twoFactorPlugin()).toEqual({
      id: 'two-factor',
      options: { issuer: 'Comp AI', allowPasswordless: true },
    });
  });

  it('challenges magic link, email OTP and OAuth callback sign-ins', () => {
    expect(isChallengedSignInPath('/sign-in/email-otp')).toBe(true);
    expect(isChallengedSignInPath('/magic-link/verify')).toBe(true);
    expect(isChallengedSignInPath('/callback/:id')).toBe(true);
    expect(isChallengedSignInPath('/get-session')).toBe(false);
    expect(isChallengedSignInPath('/two-factor/verify-totp')).toBe(false);
  });

  it('distinguishes redirect flows from JSON flows', () => {
    expect(isRedirectSignInPath('/magic-link/verify')).toBe(true);
    expect(isRedirectSignInPath('/callback/:id')).toBe(true);
    expect(isRedirectSignInPath('/sign-in/email-otp')).toBe(false);
  });

  it('builds the app verify page URL with the original destination', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://compliance.masri.tech/';
    expect(buildTwoFactorPageUrl('https://compliance.masri.tech/org_1')).toBe(
      'https://compliance.masri.tech/auth/two-factor?redirectTo=https%3A%2F%2Fcompliance.masri.tech%2Forg_1',
    );
    expect(buildTwoFactorPageUrl(undefined)).toBe(
      'https://compliance.masri.tech/auth/two-factor',
    );
  });

  it('registers one after-hook matching the challenged paths', () => {
    const plugin = mfaSignInChallenge();
    const hooks = plugin.hooks?.after ?? [];
    expect(hooks).toHaveLength(1);
    const matcher = hooks[0].matcher as (ctx: { path?: string }) => boolean;
    expect(matcher({ path: '/magic-link/verify' })).toBe(true);
    expect(matcher({ path: '/organization/list' })).toBe(false);
  });
});
