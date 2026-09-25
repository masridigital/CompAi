const mockDb = {
  $queryRaw: jest.fn(),
  clientPostureSnapshot: { findMany: jest.fn() },
};

jest.mock('@db', () => ({
  db: mockDb,
  Prisma: {
    join: (values: unknown[]) => ({ __join: values }),
  },
}));

import { attachPosture } from '../admin-organizations/admin-posture.helper';
import { ClientPostureQueryService } from './client-posture-query.service';

const row = (
  organizationId: string,
  overrides: Record<string, unknown> = {},
) => ({
  organizationId,
  capturedAt: new Date('2026-09-25T05:30:00.000Z'),
  frameworkScores: [{ frameworkId: 'frk_1', name: 'SOC 2', score: 70 }],
  overallScore: 70,
  controlsPassing: 10,
  controlsTotal: 20,
  failingChecks: 2,
  overdueTasks: 3,
  openFindings: 1,
  evidenceExpiring30d: 4,
  policiesUnpublished: 5,
  integrationErrors: 0,
  lastActivityAt: null,
  ...overrides,
});

describe('ClientPostureQueryService', () => {
  const service = new ClientPostureQueryService();

  beforeEach(() => jest.clearAllMocks());

  it('skips the query when there are no orgs', async () => {
    const result = await service.getLatestForOrganizations([]);
    expect(result.size).toBe(0);
    expect(mockDb.$queryRaw).not.toHaveBeenCalled();
  });

  it('loads the latest snapshot for all orgs in one query', async () => {
    mockDb.$queryRaw.mockResolvedValue([row('org_a')]);

    const result = await service.getLatestForOrganizations(['org_a', 'org_b']);

    expect(mockDb.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = (mockDb.$queryRaw.mock.calls[0][0] as string[]).join('?');
    expect(sql).toContain('DISTINCT ON ("organizationId")');
    expect(result.get('org_a')).toMatchObject({
      overallScore: 70,
      failingChecks: 2,
      frameworkScores: [{ frameworkId: 'frk_1', name: 'SOC 2', score: 70 }],
    });
    expect(result.has('org_b')).toBe(false);
  });

  it('drops malformed frameworkScores JSON instead of failing', async () => {
    mockDb.$queryRaw.mockResolvedValue([
      row('org_a', { frameworkScores: { bogus: true } }),
    ]);
    const result = await service.getLatestForOrganizations(['org_a']);
    expect(result.get('org_a')?.frameworkScores).toEqual([]);
  });

  it('bounds history to 1..90 days and orders oldest first', async () => {
    const now = new Date('2026-09-25T00:00:00.000Z');
    mockDb.clientPostureSnapshot.findMany.mockResolvedValue([row('org_a')]);

    const history = await service.getHistory({
      organizationId: 'org_a',
      days: 500,
      now,
    });

    expect(history).toHaveLength(1);
    expect(mockDb.clientPostureSnapshot.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org_a',
        capturedAt: { gte: new Date('2026-06-27T00:00:00.000Z') },
      },
      orderBy: { capturedAt: 'asc' },
    });
  });
});

describe('attachPosture (admin list mapping)', () => {
  it('adds posture or null per org, preserving org fields', () => {
    const posture = {
      capturedAt: new Date(),
      frameworkScores: [],
      overallScore: 50,
      controlsPassing: 0,
      controlsTotal: 0,
      failingChecks: 0,
      overdueTasks: 0,
      openFindings: 0,
      evidenceExpiring30d: 0,
      policiesUnpublished: 0,
      integrationErrors: 0,
      lastActivityAt: null,
    };
    const result = attachPosture({
      organizations: [
        { id: 'org_a', name: 'A' },
        { id: 'org_b', name: 'B' },
      ],
      postureByOrg: new Map([['org_a', posture]]),
    });
    expect(result).toEqual([
      { id: 'org_a', name: 'A', posture },
      { id: 'org_b', name: 'B', posture: null },
    ]);
  });
});
