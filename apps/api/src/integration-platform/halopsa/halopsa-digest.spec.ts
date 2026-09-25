const mockDb = {
  $transaction: jest.fn(),
  integrationConnection: { findFirst: jest.fn(), findMany: jest.fn() },
  haloTicketLink: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn() },
  haloOutboxEvent: { create: jest.fn(), updateMany: jest.fn() },
  organization: { findUnique: jest.fn() },
  task: { findMany: jest.fn() },
  policy: { findMany: jest.fn() },
  vendor: { findMany: jest.fn() },
  risk: { findMany: jest.fn() },
};

jest.mock('@db', () => ({ db: mockDb }));

import { collectDigestItems, isoWeekLabel, riskScore } from './halopsa-digest';
import { HaloDigestService } from './halopsa-digest.service';

const NOW = new Date('2026-09-28T08:00:00.000Z'); // Monday

const digestConnection = {
  id: 'icn_1',
  organizationId: 'org_1',
  variables: { alert_enabled_triggers: ['weekly_digest'], alert_resolved_status_id: 9 },
};

function emptyQueries() {
  mockDb.task.findMany.mockResolvedValue([]);
  mockDb.policy.findMany.mockResolvedValue([]);
  mockDb.vendor.findMany.mockResolvedValue([]);
  mockDb.risk.findMany.mockResolvedValue([]);
}

describe('digest helpers', () => {
  it('computes ISO week labels', () => {
    expect(isoWeekLabel(NOW)).toBe('2026-W40');
    expect(isoWeekLabel(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53');
  });

  it('scores residual risk on a 1-25 scale', () => {
    expect(riskScore({ likelihood: 'very_likely', impact: 'severe' })).toBe(25);
    expect(riskScore({ likelihood: 'possible', impact: 'major' })).toBe(12);
  });
});

describe('collectDigestItems', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    emptyQueries();
  });

  it('selects overdue tasks, expiring evidence, due policies, unassessed vendors and high risks', async () => {
    mockDb.task.findMany
      .mockResolvedValueOnce([{ id: 't1', title: 'Overdue', reviewDate: new Date('2026-09-01') }])
      .mockResolvedValueOnce([{ id: 't2', title: 'Expiring', reviewDate: new Date('2026-10-10') }]);
    mockDb.policy.findMany.mockResolvedValue([{ id: 'p1', name: 'Access', reviewDate: new Date('2026-10-01') }]);
    mockDb.vendor.findMany.mockResolvedValue([{ id: 'v1', name: 'AWS' }]);
    mockDb.risk.findMany.mockResolvedValue([
      { id: 'r1', title: 'High', residualLikelihood: 'likely', residualImpact: 'major' },
      { id: 'r2', title: 'Low', residualLikelihood: 'unlikely', residualImpact: 'minor' },
    ]);

    const items = await collectDigestItems({ organizationId: 'org_1', now: NOW });

    expect(items.overdueTasks.map((i) => i.id)).toEqual(['t1']);
    expect(items.expiringEvidence.map((i) => i.id)).toEqual(['t2']);
    expect(items.policiesDue.map((i) => i.id)).toEqual(['p1']);
    expect(items.vendorsDue.map((i) => i.id)).toEqual(['v1']);
    expect(items.risksAboveThreshold.map((i) => i.id)).toEqual(['r1']);

    const [overdueQuery, expiringQuery] = mockDb.task.findMany.mock.calls.map((c) => c[0].where);
    expect(overdueQuery).toMatchObject({ organizationId: 'org_1', reviewDate: { lt: NOW } });
    expect(expiringQuery).toMatchObject({
      status: 'done',
      reviewDate: { gte: NOW, lte: new Date(NOW.getTime() + 30 * 86_400_000) },
    });
    expect(mockDb.vendor.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org_1', status: 'not_assessed' });
  });
});

describe('HaloDigestService', () => {
  const service = new HaloDigestService();

  beforeEach(() => {
    jest.clearAllMocks();
    emptyQueries();
    mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
    mockDb.integrationConnection.findFirst.mockResolvedValue(digestConnection);
    mockDb.haloTicketLink.findUnique.mockResolvedValue(null);
    mockDb.haloTicketLink.findMany.mockResolvedValue([]);
    mockDb.haloTicketLink.create.mockResolvedValue({ id: 'htl_new' });
    mockDb.organization.findUnique.mockResolvedValue({ name: 'Acme' });
  });

  it('lists only orgs with weekly_digest enabled', async () => {
    mockDb.integrationConnection.findMany.mockResolvedValue([
      digestConnection,
      { organizationId: 'org_2', variables: { alert_enabled_triggers: ['finding_created'] } },
    ]);
    await expect(service.listDigestOrganizations()).resolves.toEqual(['org_1']);
  });

  it('skips when the trigger is off', async () => {
    mockDb.integrationConnection.findFirst.mockResolvedValue({ ...digestConnection, variables: {} });
    await expect(service.runForOrganization({ organizationId: 'org_1', now: NOW })).resolves.toBe(
      'trigger_disabled',
    );
  });

  it('closes last week and opens no ticket when nothing is due', async () => {
    mockDb.haloTicketLink.findMany.mockResolvedValue([{ id: 'htl_old', state: 'open' }]);
    await expect(service.runForOrganization({ organizationId: 'org_1', now: NOW })).resolves.toBe('no_items');
    expect(mockDb.haloTicketLink.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'htl_old' },
      data: { state: 'resolved' },
    });
    expect(mockDb.haloOutboxEvent.create.mock.calls[0][0].data).toMatchObject({
      linkId: 'htl_old',
      kind: 'set_status',
      payload: { statusId: 9 },
    });
    expect(mockDb.haloTicketLink.create).not.toHaveBeenCalled();
  });

  it('opens a P4 digest ticket when items exist', async () => {
    mockDb.vendor.findMany.mockResolvedValue([{ id: 'v1', name: 'AWS' }]);
    await expect(service.runForOrganization({ organizationId: 'org_1', now: NOW })).resolves.toBe('created');
    expect(mockDb.haloTicketLink.create.mock.calls[0][0].data).toMatchObject({
      dedupKey: 'digest:2026-W40',
      entityType: 'digest',
    });
    const event = mockDb.haloOutboxEvent.create.mock.calls[0][0].data;
    // resolvedStatusId lets a superseded digest whose create is already processing still close.
    expect(event).toMatchObject({
      kind: 'create_ticket',
      linkId: 'htl_new',
      payload: { priorityId: 4, resolvedStatusId: 9 },
    });
    expect(event.payload.summary).toContain('1 item due');
  });

  it('does not send twice in the same week', async () => {
    mockDb.haloTicketLink.findUnique.mockResolvedValue({ id: 'htl_this_week' });
    await expect(service.runForOrganization({ organizationId: 'org_1', now: NOW })).resolves.toBe(
      'already_sent',
    );
  });
});
