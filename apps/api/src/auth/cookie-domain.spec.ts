import { getCookieDomain } from './cookie-domain';

describe('getCookieDomain', () => {
  const originalBaseUrl = process.env.BASE_URL;
  const originalCookieDomain = process.env.AUTH_COOKIE_DOMAIN;

  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[key];
      return;
    }
    process.env[key] = value;
  };

  beforeEach(() => {
    delete process.env.BASE_URL;
    delete process.env.AUTH_COOKIE_DOMAIN;
  });

  afterAll(() => {
    restore('BASE_URL', originalBaseUrl);
    restore('AUTH_COOKIE_DOMAIN', originalCookieDomain);
  });

  it('keeps the hosted Comp AI domains when AUTH_COOKIE_DOMAIN is unset', () => {
    process.env.BASE_URL = 'https://api.trycomp.ai';
    expect(getCookieDomain()).toBe('.trycomp.ai');

    process.env.BASE_URL = 'https://api.staging.trycomp.ai';
    expect(getCookieDomain()).toBe('.staging.trycomp.ai');
  });

  it('falls back to host-only cookies for unknown domains', () => {
    process.env.BASE_URL = 'https://api.compliance.example.com';
    expect(getCookieDomain()).toBeUndefined();
  });

  it('uses AUTH_COOKIE_DOMAIN when it covers the API host', () => {
    process.env.BASE_URL = 'https://api.compliance.example.com';
    process.env.AUTH_COOKIE_DOMAIN = '.compliance.example.com';
    expect(getCookieDomain()).toBe('.compliance.example.com');
  });

  it('adds the leading dot and lowercases the configured domain', () => {
    process.env.BASE_URL = 'https://api.compliance.example.com';
    process.env.AUTH_COOKIE_DOMAIN = 'Compliance.Example.com';
    expect(getCookieDomain()).toBe('.compliance.example.com');
  });

  it('accepts a domain equal to the API host', () => {
    process.env.BASE_URL = 'https://compliance.example.com';
    process.env.AUTH_COOKIE_DOMAIN = '.compliance.example.com';
    expect(getCookieDomain()).toBe('.compliance.example.com');
  });

  it('rejects a domain that does not cover the API host', () => {
    process.env.BASE_URL = 'https://api.compliance.example.com';
    process.env.AUTH_COOKIE_DOMAIN = '.other.example.com';
    expect(() => getCookieDomain()).toThrow('does not cover the API host');
  });

  it('rejects a lookalike suffix that is not a real parent domain', () => {
    process.env.BASE_URL = 'https://api.evilexample.com';
    process.env.AUTH_COOKIE_DOMAIN = '.example.com';
    expect(() => getCookieDomain()).toThrow('does not cover the API host');
  });

  it('rejects a bare TLD', () => {
    process.env.BASE_URL = 'https://api.example.com';
    process.env.AUTH_COOKIE_DOMAIN = '.com';
    expect(() => getCookieDomain()).toThrow('too broad');
  });

  it('rejects AUTH_COOKIE_DOMAIN without a valid BASE_URL', () => {
    process.env.AUTH_COOKIE_DOMAIN = '.compliance.example.com';
    expect(() => getCookieDomain()).toThrow('BASE_URL');
  });
});
