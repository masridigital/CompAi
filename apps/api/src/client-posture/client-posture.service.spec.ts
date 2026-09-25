const mockDb = {
  task: { count: jest.fn(), findMany: jest.fn() },
  finding: { count: jest.fn() },
  policy: { count: jest.fn() },
  integrationConnection: { count: jest.fn() },
  auditLog: { findFirst: jest.fn() },
  evidenceSubmission: { findMany: jest.fn() },
  integrationCheckRun: { groupBy: jest.fn() },
  clientPostureSnapshot: { create: jest.fn(), deleteMany: jest.fn() },
};

jest.mock('@db', () => ({ db: mockDb }));
jest.mock('../frameworks/frameworks.service', () => ({
  FrameworksService: class {},
}));
jest.mock('../integration-platform/services/check-results.service', () => ({
  CheckResultsService: class {},
}));

import type { FrameworksService } from '../frameworks/frameworks.service';
import type { CheckResultsService } from '../integration-platform/services/check-results.service';
import { ClientPostureService } from './client-posture.service';

const NOW = new Date('2026-09-25T12:00:00.000Z');

function buildService() {
  const frameworksService = { findAll: jest.fn() };
  const checkResults = { getLatestResultsByCheck: jest.fn() };
  const service = new ClientPostureService(
    frameworksService as unknown as FrameworksService,
    checkResults as unknown as CheckResultsService,
  );
  return { service, frameworksService, checkResults };
}

describe('ClientPostureService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.task.count.mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    mockDb.finding.count.mockResolvedValue(5);
    mockDb.policy.count.mockResolvedValue(6);
    mockDb.integrationConnection.count.mockResolvedValue(1);
    mockDb.auditLog.findFirst.mockResolvedValue({
      timestamp: new Date('2026-09-24T00:00:00.000Z'),
    });
    mockDb.evidenceSubmission.findMany.mockResolvedValue([]);
    mockDb.task.findMany.mockResolvedValue([
      { status: 'done', frameworkControlLinks: [{ controlId: 'ctl_1' }] },
      { status: 'todo', frameworkControlLinks: [{ controlId: 'ctl_2' }] },
    ]);
    mockDb.integrationCheckRun.groupBy.mockResolvedValue([]);
  });

  it('computes a snapshot reusing framework scores and counts', async () => {
    const { service, frameworksService } = buildService();
    frameworksService.findAll.mockResolvedValue([
      {
        id: 'fri_1',
        frameworkId: 'frk_soc2',
        framework: { name: 'SOC 2' },
        complianceScore: 80,
        controls: [
          { id: 'ctl_1', policies: [{ status: 'published' }] },
          { id: 'ctl_2', policies: [{ status: 'draft' }] },
        ],
      },
      {
        id: 'fri_2',
        customFrameworkId: 'cfw_1',
        customFramework: { name: 'Internal' },
        complianceScore: 41,
        controls: [{ id: 'ctl_1', policies: [{ status: 'published' }] }],
      },
    ]);

    const result = await service.computeSnapshot({
      organizationId: 'org_1',
      now: NOW,
    });

    expect(frameworksService.findAll).toHaveBeenCalledWith('org_1', {
      includeControls: true,
      includeScores: true,
    });
    expect(result.frameworkScores).toEqual([
      { frameworkId: 'frk_soc2', name: 'SOC 2', score: 80 },
      { frameworkId: 'cfw_1', name: 'Internal', score: 41 },
    ]);
    expect(result.overallScore).toBe(61);
    // ctl_1 counted once across frameworks; only ctl_1 is complete.
    expect(result.controlsTotal).toBe(2);
    expect(result.controlsPassing).toBe(1);
    expect(result).toMatchObject({
      overdueTasks: 4,
      evidenceExpiring30d: 2,
      openFindings: 5,
      policiesUnpublished: 6,
      integrationErrors: 1,
      failingChecks: 0,
      lastActivityAt: new Date('2026-09-24T00:00:00.000Z'),
    });
  });

  it('scopes every count to the organization and uses the right task windows', async () => {
    const { service, frameworksService } = buildService();
    frameworksService.findAll.mockResolvedValue([]);

    await service.computeSnapshot({ organizationId: 'org_1', now: NOW });

    const [overdueArgs, expiringArgs] = mockDb.task.count.mock.calls;
    expect(overdueArgs[0].where).toMatchObject({
      organizationId: 'org_1',
      archivedAt: null,
      reviewDate: { lt: NOW },
      status: { notIn: ['done', 'not_relevant'] },
    });
    expect(expiringArgs[0].where.reviewDate).toEqual({
      gte: NOW,
      lte: new Date('2026-10-25T12:00:00.000Z'),
    });
    expect(mockDb.integrationConnection.count).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', status: 'error' },
    });
    expect(mockDb.finding.count).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', status: { not: 'closed' } },
    });
  });

  it('counts failing checks from the latest results via CheckResultsService', async () => {
    const { service, frameworksService, checkResults } = buildService();
    frameworksService.findAll.mockResolvedValue([]);
    mockDb.integrationCheckRun.groupBy.mockResolvedValue([
      { connectionId: 'icn_1', checkId: 'mfa' },
      { connectionId: 'icn_1', checkId: 's3' },
      { connectionId: 'icn_2', checkId: 'mfa' },
    ]);
    checkResults.getLatestResultsByCheck
      .mockResolvedValueOnce([{ passed: true }, { passed: false }])
      .mockResolvedValueOnce([{ passed: true }])
      .mockResolvedValueOnce([]);

    const result = await service.computeSnapshot({
      organizationId: 'org_1',
      now: NOW,
    });

    expect(result.failingChecks).toBe(1);
    expect(checkResults.getLatestResultsByCheck).toHaveBeenCalledWith({
      organizationId: 'org_1',
      connectionId: 'icn_1',
      checkId: 'mfa',
    });
    expect(mockDb.integrationCheckRun.groupBy).toHaveBeenCalledWith({
      by: ['connectionId', 'checkId'],
      where: {
        connection: {
          organizationId: 'org_1',
          status: { not: 'disconnected' },
        },
      },
    });
  });

  it('returns zero scores when the org has no frameworks', async () => {
    const { service, frameworksService } = buildService();
    frameworksService.findAll.mockResolvedValue([]);

    const result = await service.computeSnapshot({
      organizationId: 'org_1',
      now: NOW,
    });

    expect(result.frameworkScores).toEqual([]);
    expect(result.overallScore).toBe(0);
    expect(result.controlsTotal).toBe(0);
  });

  it('persists a snapshot row', async () => {
    const { service, frameworksService } = buildService();
    frameworksService.findAll.mockResolvedValue([]);
    mockDb.clientPostureSnapshot.create.mockResolvedValue({ id: 'cps_1' });

    await service.captureSnapshot('org_1');

    const args = mockDb.clientPostureSnapshot.create.mock.calls[0][0];
    expect(args.data).toMatchObject({
      organizationId: 'org_1',
      overallScore: 0,
      overdueTasks: 4,
    });
  });

  it('prunes snapshots older than the retention window', async () => {
    const { service } = buildService();
    mockDb.clientPostureSnapshot.deleteMany.mockResolvedValue({ count: 7 });

    const deleted = await service.pruneSnapshots({
      retentionDays: 30,
      now: NOW,
    });

    expect(deleted).toBe(7);
    expect(mockDb.clientPostureSnapshot.deleteMany).toHaveBeenCalledWith({
      where: { capturedAt: { lt: new Date('2026-08-26T12:00:00.000Z') } },
    });
  });
});
