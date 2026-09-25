import { UnauthorizedException } from '@nestjs/common';
import {
  buildServiceTokenHeaders,
  signOrgClaim,
} from '@trycompai/utils/service-token';
import { authenticateServiceToken } from './service-token-auth';
import { AuthenticatedRequest } from './types';

const mockOrgFindUnique = jest.fn();
const mockMemberFindFirst = jest.fn();
jest.mock('@db', () => ({
  db: {
    organization: {
      findUnique: (...args: unknown[]) => mockOrgFindUnique(...args),
    },
    member: {
      findFirst: (...args: unknown[]) => mockMemberFindFirst(...args),
    },
  },
}));

const TOKEN = 'svc_trigger_token';
const SECRET = 'trigger-signing-secret';
const ORG = 'org_1';

function buildRequest(headers: Record<string, string>): AuthenticatedRequest {
  return { headers } as unknown as AuthenticatedRequest;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function signedHeaders({
  organizationId = ORG,
  signOrg = ORG,
  timestamp = nowSeconds(),
  secret = SECRET,
}: {
  organizationId?: string;
  signOrg?: string;
  timestamp?: number;
  secret?: string;
} = {}): Record<string, string> {
  return {
    'x-service-token': TOKEN,
    'x-organization-id': organizationId,
    'x-org-timestamp': String(timestamp),
    'x-org-signature': signOrgClaim({
      organizationId: signOrg,
      timestamp,
      secret,
    }),
  };
}

async function run(headers: Record<string, string>) {
  const request = buildRequest(headers);
  await authenticateServiceToken({ request, token: headers['x-service-token'] });
  return request;
}

describe('authenticateServiceToken — signed org claim (S1)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.SERVICE_TOKEN_TRIGGER = TOKEN;
    process.env.SERVICE_TOKEN_SIGNING_SECRET_TRIGGER = SECRET;
    delete process.env.SERVICE_TOKEN_REQUIRE_ORG_SIGNATURE;
    mockOrgFindUnique.mockResolvedValue({ id: ORG });
    mockMemberFindFirst.mockResolvedValue(null);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('rejects an unknown service token', async () => {
    await expect(
      run({ 'x-service-token': 'nope', 'x-organization-id': ORG }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a request without x-organization-id', async () => {
    await expect(run({ 'x-service-token': TOKEN })).rejects.toThrow(
      'x-organization-id header is required',
    );
  });

  describe('enforcement off (default)', () => {
    it('accepts an unsigned request (legacy callers such as the trust site)', async () => {
      const request = await run({
        'x-service-token': TOKEN,
        'x-organization-id': ORG,
      });
      expect(request.isServiceToken).toBe(true);
      expect(request.organizationId).toBe(ORG);
    });

    it('accepts a valid signed claim', async () => {
      const request = await run(signedHeaders());
      expect(request.organizationId).toBe(ORG);
    });

    it('still rejects a present but invalid signature', async () => {
      await expect(run(signedHeaders({ secret: 'wrong' }))).rejects.toThrow(
        'invalid_signature',
      );
      expect(mockOrgFindUnique).not.toHaveBeenCalled();
    });

    it('accepts (with a warning) a signed claim when the API has no signing secret yet', async () => {
      delete process.env.SERVICE_TOKEN_SIGNING_SECRET_TRIGGER;
      const request = await run(signedHeaders({ secret: 'caller-only-secret' }));
      expect(request.isServiceToken).toBe(true);
      expect(request.organizationId).toBe(ORG);
    });

    it('rejects a timestamp without a signature', async () => {
      await expect(
        run({
          'x-service-token': TOKEN,
          'x-organization-id': ORG,
          'x-org-timestamp': String(nowSeconds()),
        }),
      ).rejects.toThrow('missing');
    });
  });

  describe('enforcement on', () => {
    beforeEach(() => {
      process.env.SERVICE_TOKEN_REQUIRE_ORG_SIGNATURE = 'true';
    });

    it('rejects a missing claim', async () => {
      await expect(
        run({ 'x-service-token': TOKEN, 'x-organization-id': ORG }),
      ).rejects.toThrow('Signed organization claim');
      expect(mockOrgFindUnique).not.toHaveBeenCalled();
    });

    it('rejects an expired claim (older than 300s)', async () => {
      await expect(
        run(signedHeaders({ timestamp: nowSeconds() - 301 })),
      ).rejects.toThrow('expired');
    });

    it('rejects a claim dated too far in the future', async () => {
      await expect(
        run(signedHeaders({ timestamp: nowSeconds() + 301 })),
      ).rejects.toThrow('expired');
    });

    it('accepts a claim within the 300s skew window', async () => {
      const request = await run(signedHeaders({ timestamp: nowSeconds() - 299 }));
      expect(request.organizationId).toBe(ORG);
    });

    it('rejects a claim signed for a different org', async () => {
      await expect(
        run(signedHeaders({ organizationId: 'org_victim', signOrg: ORG })),
      ).rejects.toThrow('invalid_signature');
    });

    it('rejects a malformed signature', async () => {
      await expect(
        run({ ...signedHeaders(), 'x-org-signature': 'not-hex' }),
      ).rejects.toThrow('malformed');
    });

    it('fails closed when the signing secret is not configured', async () => {
      delete process.env.SERVICE_TOKEN_SIGNING_SECRET_TRIGGER;
      await expect(run(signedHeaders())).rejects.toThrow('cannot be verified');
    });

    it('does not accept another service secret', async () => {
      process.env.SERVICE_TOKEN_SIGNING_SECRET_PORTAL = 'portal-secret';
      await expect(
        run(signedHeaders({ secret: 'portal-secret' })),
      ).rejects.toThrow('invalid_signature');
    });

    it('accepts headers produced by the shared helper', async () => {
      const headers = buildServiceTokenHeaders({
        serviceToken: TOKEN,
        organizationId: ORG,
        signingSecret: SECRET,
      });
      const request = await run(headers);
      expect(request.serviceName).toBe('Trigger.dev Workers');
    });
  });
});
