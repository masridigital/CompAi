const mockDb = {
  $transaction: jest.fn(),
  integrationConnection: { findFirst: jest.fn(), findMany: jest.fn() },
  haloTicketLink: { findUnique: jest.fn(), create: jest.fn() },
  haloOutboxEvent: { create: jest.fn() },
  organization: { findUnique: jest.fn() },
  task: { findMany: jest.fn() },
  finding: { findMany: jest.fn() },
  clientPostureSnapshot: { findMany: jest.fn() },
};

jest.mock('@db', () => ({ db: mockDb, Prisma: { join: jest.fn() } }));

import { dailyTrend, reportMonth } from './halopsa-monthly-report-data';
import { renderMonthlyReportPdf } from './halopsa-monthly-report-pdf';
import { HaloMonthlyReportService, monthlyReportFilename } from './halopsa-monthly-report.service';

const NOW = new Date('2026-10-01T09:00:00.000Z');
const connection = (variables: Record<string, unknown>) => ({ id: 'icn_1', organizationId: 'org_1', variables });

const snapshotRow = (day: string, score: number) => ({
  organizationId: 'org_1',
  capturedAt: new Date(`${day}T05:31:00Z`),
  frameworkScores: [{ frameworkId: 'f', name: 'SOC 2', score }],
  overallScore: score,
  controlsPassing: 1,
  controlsTotal: 2,
  failingChecks: 1,
  overdueTasks: 1,
  openFindings: 1,
  evidenceExpiring30d: 0,
  policiesUnpublished: 0,
  integrationErrors: 0,
  lastActivityAt: null,
});

describe('monthly report helpers', () => {
  it('reports on the previous month', () => {
    expect(reportMonth(NOW)).toEqual({ label: 'September 2026', key: '2026-09' });
    expect(reportMonth(new Date('2027-01-01T09:00:00Z')).key).toBe('2026-12');
  });

  it('keeps the last snapshot per day', () => {
    const trend = dailyTrend([
      { ...snapshotRow('2026-09-01', 50), capturedAt: new Date('2026-09-01T01:00:00Z') },
      { ...snapshotRow('2026-09-01', 55), capturedAt: new Date('2026-09-01T20:00:00Z') },
      snapshotRow('2026-09-02', 60),
    ] as never);
    expect(trend).toEqual([
      { date: '2026-09-01', overallScore: 55 },
      { date: '2026-09-02', overallScore: 60 },
    ]);
  });

  it('builds a safe filename', () => {
    expect(monthlyReportFilename({ organizationName: 'Acme, Inc. <HQ>', monthKey: '2026-09' })).toBe(
      'compai-compliance-report-acme-inc-hq-2026-09.pdf',
    );
  });

  it('renders a PDF', () => {
    const pdf = renderMonthlyReportPdf({
      organizationId: 'org_1',
      organizationName: 'Acme – “Quoted”',
      monthLabel: 'September 2026',
      generatedAt: NOW,
      latest: null,
      trend: [{ date: '2026-09-30', overallScore: 70 }],
      failingChecks: [{ title: 'MFA', detail: '2026-09-30' }],
      overdueTasks: [],
      openFindings: [{ title: 'Gap', detail: 'high' }],
      expiringEvidence: [],
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});

describe('HaloMonthlyReportService', () => {
  const service = new HaloMonthlyReportService();
  const render = jest.fn(() => Buffer.from('%PDF-1.3 test'));

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
    mockDb.integrationConnection.findFirst.mockResolvedValue(
      connection({ alert_enabled_triggers: ['monthly_report'], alert_resolved_status_id: 9 }),
    );
    mockDb.haloTicketLink.findUnique.mockResolvedValue(null);
    mockDb.haloTicketLink.create.mockResolvedValue({ id: 'htl_r' });
    mockDb.organization.findUnique.mockResolvedValue({ name: 'Acme' });
    mockDb.task.findMany.mockResolvedValue([]);
    mockDb.finding.findMany.mockResolvedValue([]);
    mockDb.clientPostureSnapshot.findMany.mockResolvedValue([snapshotRow('2026-09-30', 70)]);
  });

  it('lists only orgs with monthly_report enabled', async () => {
    mockDb.integrationConnection.findMany.mockResolvedValue([
      connection({ alert_enabled_triggers: ['monthly_report'] }),
      { id: 'icn_2', organizationId: 'org_2', variables: { alert_enabled_triggers: ['weekly_digest'] } },
    ]);
    await expect(service.listReportOrganizations()).resolves.toEqual(['org_1']);
  });

  it('skips when the trigger is off or the month was already sent', async () => {
    mockDb.integrationConnection.findFirst.mockResolvedValueOnce(connection({}));
    await expect(service.runForOrganization({ organizationId: 'org_1', now: NOW, render })).resolves.toBe(
      'trigger_disabled',
    );
    mockDb.haloTicketLink.findUnique.mockResolvedValueOnce({ id: 'htl_old' });
    await expect(service.runForOrganization({ organizationId: 'org_1', now: NOW, render })).resolves.toBe(
      'already_sent',
    );
    expect(render).not.toHaveBeenCalled();
  });

  it('queues create -> attach -> close in order', async () => {
    await expect(service.runForOrganization({ organizationId: 'org_1', now: NOW, render })).resolves.toBe('queued');

    expect(mockDb.haloTicketLink.create.mock.calls[0][0].data).toMatchObject({
      dedupKey: 'monthly_report:2026-09',
      entityType: 'report',
    });
    const events = mockDb.haloOutboxEvent.create.mock.calls.map((c) => c[0].data);
    expect(events.map((e) => e.kind)).toEqual(['create_ticket', 'attach_file', 'set_status']);
    expect(events[0].payload.summary).toMatch(/^\[CompAI\] Monthly compliance report September 2026 \[CAI-/);
    expect(events[0].payload.details).toContain('70%');
    expect(events[1].payload).toEqual({
      filename: 'compai-compliance-report-acme-2026-09.pdf',
      base64: Buffer.from('%PDF-1.3 test').toString('base64'),
    });
    expect(events[2].payload).toMatchObject({ statusId: 9, afterPrior: true, markLinkResolved: true });
    const times = events.map((e) => e.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(3);
  });

  it('leaves the ticket open when no resolved status is configured', async () => {
    mockDb.integrationConnection.findFirst.mockResolvedValue(connection({ alert_enabled_triggers: ['monthly_report'] }));
    await service.runForOrganization({ organizationId: 'org_1', now: NOW, render });
    expect(mockDb.haloOutboxEvent.create.mock.calls.map((c) => c[0].data.kind)).toEqual([
      'create_ticket',
      'attach_file',
    ]);
  });

  it('refuses PDFs over 10 MB', async () => {
    const big = jest.fn(() => Buffer.alloc(10 * 1024 * 1024 + 1));
    await expect(service.runForOrganization({ organizationId: 'org_1', now: NOW, render: big })).resolves.toBe(
      'too_large',
    );
    expect(mockDb.haloTicketLink.create).not.toHaveBeenCalled();
  });
});
