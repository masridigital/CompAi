import { describe, expect, it } from 'bun:test';
import {
  buildServiceTokenHeaders,
  signOrgClaim,
  signingSecretEnvVar,
  verifyOrgClaim,
} from './service-token';

const SECRET = 'secret';
const NOW = 1_800_000_000;

describe('service-token org claim helpers', () => {
  it('signs `${orgId}.${timestamp}` with hex HMAC-SHA256', () => {
    const signature = signOrgClaim({
      organizationId: 'org_1',
      timestamp: NOW,
      secret: SECRET,
    });
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('omits signature headers when no signing secret is configured', () => {
    const headers = buildServiceTokenHeaders({
      serviceToken: 'tok',
      organizationId: 'org_1',
    });
    expect(headers).toEqual({
      'x-service-token': 'tok',
      'x-organization-id': 'org_1',
    });
  });

  it('round-trips a signed claim', () => {
    const headers = buildServiceTokenHeaders({
      serviceToken: 'tok',
      organizationId: 'org_1',
      signingSecret: SECRET,
      now: NOW,
    });
    expect(headers['x-org-timestamp']).toBe(String(NOW));
    const result = verifyOrgClaim({
      organizationId: 'org_1',
      timestamp: headers['x-org-timestamp'],
      signature: headers['x-org-signature'],
      secret: SECRET,
      now: NOW + 10,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects expired, wrong-org and missing claims', () => {
    const signature = signOrgClaim({
      organizationId: 'org_1',
      timestamp: NOW,
      secret: SECRET,
    });
    const base = { timestamp: String(NOW), signature, secret: SECRET };
    expect(
      verifyOrgClaim({ ...base, organizationId: 'org_1', now: NOW + 301 }),
    ).toEqual({ ok: false, reason: 'expired' });
    expect(
      verifyOrgClaim({ ...base, organizationId: 'org_2', now: NOW }),
    ).toEqual({ ok: false, reason: 'invalid_signature' });
    expect(
      verifyOrgClaim({
        organizationId: 'org_1',
        timestamp: undefined,
        signature: undefined,
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: 'missing' });
  });

  it('names the per-service env var', () => {
    expect(signingSecretEnvVar('portal')).toBe(
      'SERVICE_TOKEN_SIGNING_SECRET_PORTAL',
    );
  });
});
