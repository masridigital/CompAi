import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed organization claims for internal service-token calls.
 *
 * A service token proves WHICH service is calling. The signed org claim proves
 * the caller intended to act on THIS organization at roughly THIS time, so a
 * leaked token plus an arbitrary `x-organization-id` is not enough to reach
 * another tenant.
 *
 * Wire format (all headers are strings):
 *   x-organization-id: <orgId>
 *   x-org-timestamp:   <unix seconds>
 *   x-org-signature:   hex(HMAC-SHA256(secret, `${orgId}.${timestamp}`))
 *
 * The secret is per service: SERVICE_TOKEN_SIGNING_SECRET_<SERVICE>
 * (e.g. SERVICE_TOKEN_SIGNING_SECRET_TRIGGER, _PORTAL, _TRUST). It must be
 * different from the service token itself.
 */

export const SERVICE_TOKEN_HEADER = 'x-service-token';
export const ORGANIZATION_ID_HEADER = 'x-organization-id';
export const ORG_SIGNATURE_HEADER = 'x-org-signature';
export const ORG_TIMESTAMP_HEADER = 'x-org-timestamp';

/** Maximum allowed clock skew between caller and API, in seconds. */
export const ORG_CLAIM_MAX_SKEW_SECONDS = 300;

export type ServiceTokenService = 'trigger' | 'portal' | 'trust';

export function signingSecretEnvVar(service: ServiceTokenService): string {
  return `SERVICE_TOKEN_SIGNING_SECRET_${service.toUpperCase()}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function signOrgClaim({
  organizationId,
  timestamp,
  secret,
}: {
  organizationId: string;
  timestamp: number | string;
  secret: string;
}): string {
  return createHmac('sha256', secret)
    .update(`${organizationId}.${timestamp}`)
    .digest('hex');
}

/**
 * Build the headers for a service-token call. When `signingSecret` is empty
 * the signature headers are omitted, which only works while the API runs with
 * SERVICE_TOKEN_REQUIRE_ORG_SIGNATURE=false.
 */
export function buildServiceTokenHeaders({
  serviceToken,
  organizationId,
  signingSecret,
  now = nowSeconds(),
}: {
  serviceToken: string;
  organizationId: string;
  signingSecret?: string | null;
  now?: number;
}): Record<string, string> {
  const headers: Record<string, string> = {
    [SERVICE_TOKEN_HEADER]: serviceToken,
    [ORGANIZATION_ID_HEADER]: organizationId,
  };
  if (!signingSecret) return headers;

  const timestamp = String(now);
  headers[ORG_TIMESTAMP_HEADER] = timestamp;
  headers[ORG_SIGNATURE_HEADER] = signOrgClaim({
    organizationId,
    timestamp,
    secret: signingSecret,
  });
  return headers;
}

export type OrgClaimFailure =
  | 'missing'
  | 'malformed'
  | 'expired'
  | 'invalid_signature';

export type OrgClaimResult = { ok: true } | { ok: false; reason: OrgClaimFailure };

/** Verify a signed org claim in constant time with a bounded clock skew. */
export function verifyOrgClaim({
  organizationId,
  timestamp,
  signature,
  secret,
  now = nowSeconds(),
  maxSkewSeconds = ORG_CLAIM_MAX_SKEW_SECONDS,
}: {
  organizationId: string;
  timestamp: string | undefined;
  signature: string | undefined;
  secret: string;
  now?: number;
  maxSkewSeconds?: number;
}): OrgClaimResult {
  if (!timestamp || !signature) return { ok: false, reason: 'missing' };
  if (!/^\d{1,12}$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(signature)) {
    return { ok: false, reason: 'malformed' };
  }
  if (Math.abs(now - Number(timestamp)) > maxSkewSeconds) {
    return { ok: false, reason: 'expired' };
  }

  const expected = Buffer.from(
    signOrgClaim({ organizationId, timestamp, secret }),
    'hex',
  );
  const provided = Buffer.from(signature, 'hex');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, reason: 'invalid_signature' };
  }
  return { ok: true };
}
