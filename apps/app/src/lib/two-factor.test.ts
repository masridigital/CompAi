import { describe, expect, it } from 'vitest';
import {
  isMfaRequiredBody,
  resolvePostTwoFactorRedirect,
  secretFromTotpUri,
  totpCodeSchema,
} from './two-factor';

const APP = 'https://compliance.masri.tech';
const PORTAL = 'https://employee.compliance.masri.tech';

describe('two-factor helpers', () => {
  it.each([
    [undefined, '/'],
    ['/org_1/overview?tab=a', '/org_1/overview?tab=a'],
    ['//evil.example', '/'],
    ['/x?next=https://evil.example', '/x?next=https://evil.example'],
    [`${APP}/org_1`, '/org_1'],
    [`${PORTAL}/`, `${PORTAL}/`],
    ['https://evil.example/', '/'],
    ['javascript:alert(1)', '/'],
    ['not a url', '/'],
  ])('resolvePostTwoFactorRedirect(%s) → %s', (redirectTo, expected) => {
    expect(resolvePostTwoFactorRedirect({ redirectTo, appOrigin: APP, portalUrl: PORTAL })).toBe(
      expected,
    );
  });

  it('detects the MFA_REQUIRED body', () => {
    expect(isMfaRequiredBody({ code: 'MFA_REQUIRED', message: 'x' })).toBe(true);
    expect(isMfaRequiredBody({ message: 'Forbidden' })).toBe(false);
    expect(isMfaRequiredBody(null)).toBe(false);
  });

  it('extracts the secret from an otpauth URI', () => {
    expect(secretFromTotpUri('otpauth://totp/A:b?secret=ABC&issuer=A')).toBe('ABC');
    expect(secretFromTotpUri('::bad')).toBeNull();
  });

  it('accepts only 6-digit codes', () => {
    expect(totpCodeSchema.safeParse({ code: ' 123456 ' }).success).toBe(true);
    expect(totpCodeSchema.safeParse({ code: '12345' }).success).toBe(false);
    expect(totpCodeSchema.safeParse({ code: 'abcdef' }).success).toBe(false);
  });
});
