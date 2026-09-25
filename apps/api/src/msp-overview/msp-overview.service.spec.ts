jest.mock('@trycompai/auth', () =>
  jest.requireActual('./msp-auth.test-fixture'),
);
const mockHaloGroupBy = jest.fn();
const mockConnectionFindMany = jest.fn();
const mockRunGroupBy = jest.fn();
const mockRunFindMany = jest.fn();

jest.mock('@db', () => ({
  db: {
    haloTicketLink: { groupBy: (...a: unknown[]) => mockHaloGroupBy(...a) },
    integrationConnection: {
      findMany: (...a: unknown[]) => mockConnectionFindMany(...a),
    },
    integrationCheckRun: {
      groupBy: (...a: unknown[]) => mockRunGroupBy(...a),
      findMany: (...a: unknown[]) => mockRunFindMany(...a),
    },
  },
  Prisma: { join: jest.fn() },
}));

import type { ClientPostureQueryService } from '../client-posture/client-posture-query.service';
import type { ClientPostureSummary } from '../client-posture/client-posture.types';
import type { CheckResultsService } from '../integration-platform/services/check-results.service';
import { MspChecksQuery } from './msp-checks.query';
import { MspOverviewService } from './msp-overview.service';
import type { MspScope } from './msp-scope';

function posture(
  overrides: Partial<ClientPostureSummary> = {},
): ClientPostureSummary {
  return {
    capturedAt: new Date('2026-09-25T00:00:00Z'),
    frameworkScores: [],
    overallScore: 80,
    controlsPassing: 8,
    controlsTotal: 10,
    failingChecks: 2,
    overdueTasks: 3,
    openFindings: 4,
    evidenceExpiring30d: 5,
    policiesUnpublished: 1,
    integrationErrors: 0,
    lastActivityAt: new Date('2026-09-24T00:00:00Z'),
    ...overrides,
  };
}

// org_a: full member permissions. org_b: app + finding only.
const staffScope: MspScope = {
  isPlatformAdmin: false,
  orgs: [
    { id: 'org_a', name: 'Alpha', logo: null },
    { id: 'org_b', name: 'Beta', logo: 'b.png' },
  ],
  permissionsByOrg: new Map<string, Record<string, string[]>>([
    [
      'org_a',
      {
        app: ['read'],
        task: ['read'],
        finding: ['read'],
        integration: ['read'],
        evidence: ['read'],
        framework: ['read'],
        policy: ['read'],
      },
    ],
    ['org_b', { app: ['read'], finding: ['read'] }],
  ]),
};

describe('MspOverviewService', () => {
  const getLatestForOrganizations = jest.fn();
  const postureQuery = {
    getLatestForOrganizations,
  } as unknown as ClientPostureQueryService;
  const service = new MspOverviewService(postureQuery);

  beforeEach(() => {
    jest.clearAllMocks();
    getLatestForOrganizations.mockResolvedValue(
      new Map([
        ['org_a', posture()],
        ['org_b', posture({ overallScore: 40, openFindings: 6 })],
      ]),
    );
    mockHaloGroupBy.mockResolvedValue([
      { organizationId: 'org_a', _count: { _all: 7 } },
    ]);
    mockConnectionFindMany.mockResolvedValue([
      {
        organizationId: 'org_a',
        metadata: { haloClientId: 12, haloClientName: 'Alpha Ltd' },
      },
    ]);
  });

  it('batches: one posture call for all orgs, halo lookups only for integration:read orgs', async () => {
    await service.getOverview(staffScope);
    expect(getLatestForOrganizations).toHaveBeenCalledTimes(1);
    expect(getLatestForOrganizations).toHaveBeenCalledWith(['org_a', 'org_b']);
    expect(mockHaloGroupBy.mock.calls[0][0].where.organizationId).toEqual({
      in: ['org_a'],
    });
    expect(
      mockConnectionFindMany.mock.calls[0][0].where.organizationId,
    ).toEqual({ in: ['org_a'] });
  });

  it('masks fields the viewer may not read and totals only visible values', async () => {
    const { clients, totals } = await service.getOverview(staffScope);
    const beta = clients.find((c) => c.organizationId === 'org_b');
    expect(beta?.posture).toMatchObject({
      overallScore: null,
      overdueTasks: null,
      failingChecks: null,
      evidenceExpiring30d: null,
      openFindings: 6,
    });
    expect(beta?.haloClient).toBeNull();
    expect(beta?.openHaloTickets).toBeNull();

    const alpha = clients.find((c) => c.organizationId === 'org_a');
    expect(alpha?.haloClient).toMatchObject({ id: 12, name: 'Alpha Ltd' });
    expect(alpha?.openHaloTickets).toBe(7);

    expect(totals).toEqual({
      clients: 2,
      avgScore: 80,
      failingChecks: 2,
      overdueTasks: 3,
      openFindings: 10,
      evidenceExpiring30d: 5,
      openHaloTickets: 7,
    });
  });

  it('platform admins see every field', async () => {
    const adminScope: MspScope = {
      ...staffScope,
      isPlatformAdmin: true,
      permissionsByOrg: new Map(),
    };
    const { totals } = await service.getOverview(adminScope);
    expect(totals.avgScore).toBe(60);
    expect(totals.overdueTasks).toBe(6);
  });
});

describe('MspChecksQuery', () => {
  const getLatestResultsByCheck = jest.fn();
  const checkResults = {
    getLatestResultsByCheck,
  } as unknown as CheckResultsService;
  const query = new MspChecksQuery(checkResults);

  beforeEach(() => jest.clearAllMocks());

  it('only inspects connections in orgs with integration:read and reports failing checks', async () => {
    mockConnectionFindMany.mockResolvedValue([
      { id: 'icn_1', organizationId: 'org_a', provider: { slug: 'aws' } },
    ]);
    mockRunGroupBy.mockResolvedValue([
      { connectionId: 'icn_1', checkId: 's3-encryption' },
      { connectionId: 'icn_1', checkId: 'mfa' },
    ]);
    getLatestResultsByCheck.mockImplementation(
      async ({ checkId }: { checkId: string }) =>
        checkId === 's3-encryption'
          ? [
              { passed: false, runId: 'icr_1' },
              { passed: false, runId: 'icr_1' },
              { passed: true, runId: 'icr_1' },
            ]
          : [{ passed: true, runId: 'icr_2' }],
    );
    const completedAt = new Date('2026-09-25T01:00:00Z');
    mockRunFindMany.mockResolvedValue([
      {
        id: 'icr_1',
        checkName: 'S3 encryption',
        completedAt,
        createdAt: completedAt,
        taskId: 'tsk_9',
        task: { organizationId: 'org_a' },
      },
    ]);

    const { data } = await query.listFailing(staffScope);

    expect(
      mockConnectionFindMany.mock.calls[0][0].where.organizationId,
    ).toEqual({ in: ['org_a'] });
    expect(getLatestResultsByCheck).toHaveBeenCalledWith({
      organizationId: 'org_a',
      connectionId: 'icn_1',
      checkId: 's3-encryption',
    });
    expect(data).toEqual([
      {
        organizationId: 'org_a',
        orgName: 'Alpha',
        connectionId: 'icn_1',
        provider: 'aws',
        checkId: 's3-encryption',
        checkName: 'S3 encryption',
        failingResources: 2,
        lastRunAt: completedAt,
        taskId: 'tsk_9',
      },
    ]);
  });

  it('returns nothing without integration:read in any org', async () => {
    const noIntegration: MspScope = {
      ...staffScope,
      orgs: [staffScope.orgs[1]],
    };
    const { data } = await query.listFailing(noIntegration);
    expect(data).toEqual([]);
    expect(mockConnectionFindMany).not.toHaveBeenCalled();
  });
});
