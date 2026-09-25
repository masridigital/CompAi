const mockDb = {
  $transaction: jest.fn(),
  integrationConnection: { findFirst: jest.fn() },
  haloTicketLink: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  haloOutboxEvent: { count: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
  organization: { findUnique: jest.fn() },
};

jest.mock('@db', () => ({ db: mockDb, Prisma: {} }));
jest.mock('./halopsa-drain-trigger', () => ({ triggerDrainSoon: jest.fn() }));

import { HaloAlertService } from './halopsa-alert.service';
import { triggerDrainSoon } from './halopsa-drain-trigger';

const NOW = new Date('2026-09-25T12:00:00.000Z');

class TestAlertService extends HaloAlertService {
  protected now(): Date {
    return NOW;
  }
}

const connection = (variables: Record<string, unknown>) => ({
  id: 'icn_1',
  organizationId: 'org_1',
  variables,
  metadata: {},
});

const enabledAll = {
  alert_enabled_triggers: ['integration_check_failed', 'finding_created', 'device_noncompliant'],
  alert_resolved_status_id: 9,
};

const checkInput = (passed: boolean) => ({
  organizationId: 'org_1',
  connectionId: 'icn_gws',
  checkId: 'mfa',
  checkName: 'MFA enabled',
  passed,
  severity: passed ? null : ('high' as const),
  failingResources: passed ? [] : [{ title: 'alice', resourceId: 'u1' }],
  remediation: 'Turn on MFA',
  taskId: 'tsk_1',
});

const eventKinds = () => mockDb.haloOutboxEvent.create.mock.calls.map((c) => c[0].data.kind);

describe('HaloAlertService', () => {
  const service = new TestAlertService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
    mockDb.integrationConnection.findFirst.mockResolvedValue(connection(enabledAll));
    mockDb.haloTicketLink.findUnique.mockResolvedValue(null);
    mockDb.haloTicketLink.create.mockImplementation(({ data }) => ({ id: 'htl_1', ...data }));
    mockDb.haloTicketLink.update.mockImplementation(({ data }) => ({ id: 'htl_1', ...data }));
    mockDb.haloOutboxEvent.count.mockResolvedValue(0);
    mockDb.organization.findUnique.mockResolvedValue({
      name: 'Acme',
      frameworkInstances: [{ framework: { name: 'SOC 2' }, customFramework: null }],
    });
  });

  it('exits when the org has no halopsa connection', async () => {
    mockDb.integrationConnection.findFirst.mockResolvedValue(null);
    await expect(service.onCheckResult(checkInput(false))).resolves.toBe('no_connection');
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it('exits when the trigger is not enabled', async () => {
    mockDb.integrationConnection.findFirst.mockResolvedValue(connection({ alert_enabled_triggers: [] }));
    await expect(service.onCheckResult(checkInput(false))).resolves.toBe('trigger_disabled');
  });

  it('exits below the minimum severity', async () => {
    mockDb.integrationConnection.findFirst.mockResolvedValue(
      connection({ ...enabledAll, alert_min_severity: 'critical' }),
    );
    await expect(service.onCheckResult(checkInput(false))).resolves.toBe('below_min_severity');
  });

  it('creates a link and a create_ticket event on first failure', async () => {
    await expect(service.onCheckResult(checkInput(false))).resolves.toBe('create');

    const linkData = mockDb.haloTicketLink.create.mock.calls[0][0].data;
    expect(linkData).toMatchObject({
      organizationId: 'org_1',
      connectionId: 'icn_1',
      dedupKey: 'integration_check_failed:icn_gws:mfa',
      entityType: 'check',
      entityId: 'tsk_1',
      state: 'pending_create',
    });
    const event = mockDb.haloOutboxEvent.create.mock.calls[0][0].data;
    expect(event.kind).toBe('create_ticket');
    expect(event.payload.priorityId).toBe(2); // high severity check -> P2
    expect(event.payload.summary).toContain(linkData.refToken);
    expect(event.payload.details).toContain('SOC 2');
    expect(triggerDrainSoon).toHaveBeenCalled();
  });

  it('adds a note on repeat failure', async () => {
    mockDb.haloTicketLink.findUnique.mockResolvedValue({
      id: 'htl_1',
      state: 'open',
      haloTicketId: 55,
      resolvedAt: null,
      refToken: 'CAI-AAAAAAAA',
    });
    await expect(service.onCheckResult(checkInput(false))).resolves.toBe('note');
    expect(eventKinds()).toEqual(['add_note']);
    expect(mockDb.haloTicketLink.create).not.toHaveBeenCalled();
  });

  it('resolves an open ticket when the check passes, even with the trigger off', async () => {
    mockDb.integrationConnection.findFirst.mockResolvedValue(
      connection({ alert_enabled_triggers: [], alert_resolved_status_id: 9 }),
    );
    mockDb.haloTicketLink.findUnique.mockResolvedValue({
      id: 'htl_1',
      state: 'open',
      haloTicketId: 55,
      resolvedAt: null,
      refToken: 'CAI-AAAAAAAA',
    });
    await expect(service.onCheckResult(checkInput(true))).resolves.toBe('resolve');
    const event = mockDb.haloOutboxEvent.create.mock.calls[0][0].data;
    expect(event.kind).toBe('set_status');
    expect(event.payload.statusId).toBe(9);
    expect(mockDb.haloTicketLink.update.mock.calls[0][0].data).toMatchObject({
      state: 'resolved',
      resolvedAt: NOW,
    });
  });

  it('reopens the same ticket on regression within 7 days', async () => {
    mockDb.haloTicketLink.findUnique.mockResolvedValue({
      id: 'htl_1',
      state: 'resolved',
      haloTicketId: 55,
      resolvedAt: new Date(NOW.getTime() - 2 * 86_400_000),
      refToken: 'CAI-AAAAAAAA',
    });
    await expect(service.onCheckResult(checkInput(false))).resolves.toBe('reopen');
    const event = mockDb.haloOutboxEvent.create.mock.calls[0][0].data;
    expect(event.kind).toBe('reopen');
    expect(event.payload.fallback.summary).toContain('CAI-AAAAAAAA');
  });

  it('opens a new ticket with a new ref token after 7 days', async () => {
    mockDb.haloTicketLink.findUnique.mockResolvedValue({
      id: 'htl_1',
      state: 'resolved',
      haloTicketId: 55,
      resolvedAt: new Date(NOW.getTime() - 10 * 86_400_000),
      refToken: 'CAI-AAAAAAAA',
    });
    await expect(service.onCheckResult(checkInput(false))).resolves.toBe('create');
    const update = mockDb.haloTicketLink.update.mock.calls[0][0].data;
    expect(update.refToken).not.toBe('CAI-AAAAAAAA');
    expect(update).toMatchObject({ haloTicketId: null, state: 'pending_create' });
    expect(eventKinds()).toEqual(['create_ticket']);
  });

  it('maps finding severity to priority', async () => {
    await service.onFindingCreated({
      organizationId: 'org_1',
      findingId: 'fnd_1',
      title: 'Gap',
      severity: 'critical',
    });
    const event = mockDb.haloOutboxEvent.create.mock.calls[0][0].data;
    expect(event.payload.priorityId).toBe(1);
    expect(mockDb.haloTicketLink.create.mock.calls[0][0].data.dedupKey).toBe('finding:fnd_1');
  });

  it('waits 24h before alerting on a noncompliant device', async () => {
    const base = { organizationId: 'org_1', deviceId: 'dev_1', deviceName: 'MBP', compliant: false };
    await expect(
      service.onDeviceCompliance({ ...base, nonCompliantSince: new Date(NOW.getTime() - 3_600_000) }),
    ).resolves.toBe('grace_period');
    await expect(service.onDeviceCompliance({ ...base, nonCompliantSince: null })).resolves.toBe(
      'grace_period',
    );
    await expect(
      service.onDeviceCompliance({ ...base, nonCompliantSince: new Date(NOW.getTime() - 25 * 3_600_000) }),
    ).resolves.toBe('create');
    expect(mockDb.haloTicketLink.create.mock.calls[0][0].data.dedupKey).toBe('device:dev_1');
  });
});
