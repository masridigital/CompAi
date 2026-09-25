import { isStaticTrustedOrigin } from './origin-policy';

describe('isStaticTrustedOrigin', () => {
  const originalTrustedOrigins = process.env.AUTH_TRUSTED_ORIGINS;
  const originalSuffixes = process.env.AUTH_TRUSTED_ORIGIN_SUFFIXES;

  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[key];
      return;
    }
    process.env[key] = value;
  };

  beforeEach(() => {
    delete process.env.AUTH_TRUSTED_ORIGINS;
    delete process.env.AUTH_TRUSTED_ORIGIN_SUFFIXES;
  });

  afterAll(() => {
    restore('AUTH_TRUSTED_ORIGINS', originalTrustedOrigins);
    restore('AUTH_TRUSTED_ORIGIN_SUFFIXES', originalSuffixes);
  });

  it('trusts HTTPS subdomains of the wildcard domains', () => {
    expect(isStaticTrustedOrigin('https://anything.trycomp.ai')).toBe(true);
    expect(isStaticTrustedOrigin('https://anything.staging.trycomp.ai')).toBe(true);
    expect(isStaticTrustedOrigin('https://anything.trust.inc')).toBe(true);
    expect(isStaticTrustedOrigin('https://trust.inc')).toBe(true);
  });

  it('does not extend the wildcard match to plain HTTP', () => {
    expect(isStaticTrustedOrigin('http://anything.trycomp.ai')).toBe(false);
    expect(isStaticTrustedOrigin('http://anything.staging.trycomp.ai')).toBe(false);
    expect(isStaticTrustedOrigin('http://anything.trust.inc')).toBe(false);
    expect(isStaticTrustedOrigin('http://trust.inc')).toBe(false);
  });

  it('still trusts the explicitly listed http localhost origins', () => {
    expect(isStaticTrustedOrigin('http://localhost:3000')).toBe(true);
    expect(isStaticTrustedOrigin('http://localhost:3333')).toBe(true);
  });

  it('honours an explicit AUTH_TRUSTED_ORIGINS list', () => {
    process.env.AUTH_TRUSTED_ORIGINS = 'http://localhost:4000';
    expect(isStaticTrustedOrigin('http://localhost:4000')).toBe(true);
    expect(isStaticTrustedOrigin('http://localhost:3000')).toBe(false);
  });

  it('rejects unrelated and malformed origins', () => {
    expect(isStaticTrustedOrigin('https://trycomp.ai.untrusted.example')).toBe(false);
    expect(isStaticTrustedOrigin('https://nottrust.inc')).toBe(false);
    expect(isStaticTrustedOrigin('not-a-url')).toBe(false);
    expect(isStaticTrustedOrigin('')).toBe(false);
  });

  describe('with AUTH_TRUSTED_ORIGIN_SUFFIXES', () => {
    beforeEach(() => {
      // Self-hosted deployments set both variables together.
      process.env.AUTH_TRUSTED_ORIGINS = 'https://compliance.example.com';
      process.env.AUTH_TRUSTED_ORIGIN_SUFFIXES = '.compliance.example.com';
    });

    it('trusts the explicit apex origin and HTTPS subdomains of the suffix', () => {
      expect(isStaticTrustedOrigin('https://compliance.example.com')).toBe(true);
      expect(isStaticTrustedOrigin('https://app.compliance.example.com')).toBe(true);
      expect(isStaticTrustedOrigin('https://api.compliance.example.com')).toBe(true);
    });

    it('stops trusting the hosted Comp AI domains', () => {
      expect(isStaticTrustedOrigin('https://app.trycomp.ai')).toBe(false);
      expect(isStaticTrustedOrigin('https://anything.trust.inc')).toBe(false);
      expect(isStaticTrustedOrigin('https://trust.inc')).toBe(false);
    });

    it('does not trust sibling hosts on the parent domain', () => {
      expect(isStaticTrustedOrigin('https://portal.example.com')).toBe(false);
      expect(isStaticTrustedOrigin('https://evilcompliance.example.com')).toBe(false);
    });

    it('stays HTTPS-only', () => {
      expect(isStaticTrustedOrigin('http://app.compliance.example.com')).toBe(false);
    });

    it('accepts suffixes without a leading dot and in mixed case', () => {
      process.env.AUTH_TRUSTED_ORIGIN_SUFFIXES = 'Compliance.Example.com';
      expect(isStaticTrustedOrigin('https://app.compliance.example.com')).toBe(true);
    });

    it('ignores a bare TLD suffix', () => {
      process.env.AUTH_TRUSTED_ORIGIN_SUFFIXES = '.com';
      expect(isStaticTrustedOrigin('https://anything.com')).toBe(false);
      expect(isStaticTrustedOrigin('https://anything.trycomp.ai')).toBe(true);
    });
  });
});
