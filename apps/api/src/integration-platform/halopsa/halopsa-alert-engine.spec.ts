interface FakeLink {
  id: string;
  organizationId: string;
  dedupKey: string;
  refToken: string;
  state: string;
  haloTicketId: number | null;
  resolvedAt: Date | null;
  [key: string]: unknown;
}

const links = new Map<string, FakeLink>();
const events: Array<{ linkId: string; kind: string; payload: Record<string, unknown>; status: string }> = [];
let nextId = 1;

function byKey(organizationId: string, dedupKey: string) {
  return [...links.values()].find((l) => l.organizationId === organizationId && l.dedupKey === dedupKey) ?? null;
}

const mockDb = {
  $transaction: jest.fn(),
  integrationConnection: { findFirst: jest.fn() },
  organization: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme', frameworkInstances: [] }) },
  haloTicketLink: {
    findUnique: jest.fn(async ({ where }) =>
      byKey(where.organizationId_dedupKey.organizationId, where.organizationId_dedupKey.dedupKey),
    ),
    create: jest.fn(async ({ data }) => {
      if (byKey(data.organizationId, data.dedupKey)) throw Object.assign(new Error('unique'), { code: 'P2002' });
      const link = { id: `htl_${nextId++}`, ...data } as FakeLink;
      links.set(link.id, link);
      return link;
    }),
    update: jest.fn(async ({ where, data }) => {
      const link = { ...links.get(where.id), ...data } as FakeLink;
      links.set(link.id, link);
      return link;
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      const link = links.get(where.id);
      if (!link || (where.dedupKey && link.dedupKey !== where.dedupKey)) return { count: 0 };
      links.set(link.id, { ...link, ...data });
      return { count: 1 };
    }),
  },
  haloOutboxEvent: {
    count: jest.fn(async ({ where }) => events.filter((e) => e.linkId === where.linkId && e.status === 'pending').length),
    create: jest.fn(async ({ data }) => events.push({ ...data })),
    updateMany: jest.fn(async () => ({ count: 0 })),
  },
};

jest.mock('@db', () => ({ db: mockDb, Prisma: {} }));
jest.mock('./halopsa-drain-trigger', () => ({ triggerDrainSoon: jest.fn() }));

import { HaloAlertService } from './halopsa-alert.service';

const check = ({ connectionId, passed }: { connectionId: string; passed: boolean }) => ({
  organizationId: 'org_1',
  connectionId,
  checkId: 'aws-s3-public',
  checkName: 'S3 not public',
  passed,
  severity: passed ? null : ('high' as const),
  failingResources: passed ? [] : [{ title: 'bucket', resourceId: 'b1' }],
  taskId: 'tsk_1',
});

describe('alert engine: check dedupKey per connection', () => {
  const service = new HaloAlertService();

  beforeEach(() => {
    jest.clearAllMocks();
    links.clear();
    events.length = 0;
    mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
    mockDb.integrationConnection.findFirst.mockResolvedValue({
      id: 'icn_halo',
      organizationId: 'org_1',
      metadata: {},
      variables: { alert_enabled_triggers: ['integration_check_failed'], alert_resolved_status_id: 9 },
    });
  });

  it('keeps two connections of the same check apart (one failing, one passing)', async () => {
    await expect(service.onCheckResult(check({ connectionId: 'icn_aws_a', passed: false }))).resolves.toBe('create');
    await expect(service.onCheckResult(check({ connectionId: 'icn_aws_b', passed: true }))).resolves.toBe('none');

    expect([...links.values()].map((l) => [l.dedupKey, l.state])).toEqual([
      ['integration_check_failed:icn_aws_a:aws-s3-public', 'pending_create'],
    ]);
    expect(events.map((e) => e.kind)).toEqual(['create_ticket']);
  });

  it('adopts a link stored under the legacy key when resolving', async () => {
    links.set('htl_old', {
      id: 'htl_old',
      organizationId: 'org_1',
      dedupKey: 'integration_check_failed:aws-s3-public',
      refToken: 'CAI-OLD',
      state: 'open',
      haloTicketId: 55,
      resolvedAt: null,
    });
    await expect(service.onCheckResult(check({ connectionId: 'icn_aws_a', passed: true }))).resolves.toBe('resolve');
    expect(links.get('htl_old')).toMatchObject({
      dedupKey: 'integration_check_failed:icn_aws_a:aws-s3-public',
      state: 'resolved',
    });
    expect(events.map((e) => e.kind)).toEqual(['set_status']);
    // The other connection no longer matches the adopted legacy link.
    await expect(service.onCheckResult(check({ connectionId: 'icn_aws_b', passed: true }))).resolves.toBe('none');
  });
});

describe('alert engine races', () => {
  const service = new HaloAlertService();

  beforeEach(() => {
    jest.clearAllMocks();
    links.clear();
    events.length = 0;
    mockDb.integrationConnection.findFirst.mockResolvedValue({
      id: 'icn_halo',
      organizationId: 'org_1',
      metadata: {},
      variables: { alert_enabled_triggers: ['integration_check_failed'] },
    });
  });

  it('retries once on a unique-index race and does not enqueue a second create', async () => {
    let first = true;
    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => {
      if (first) {
        first = false;
        // A concurrent signal commits its link between our read and our create.
        const result = fn({
          ...mockDb,
          haloTicketLink: {
            ...mockDb.haloTicketLink,
            findUnique: jest.fn(async (_args: unknown): Promise<FakeLink | null> => null),
            create: jest.fn(async ({ data }) => {
              links.set('htl_winner', { id: 'htl_winner', ...data, organizationId: 'org_1' } as FakeLink);
              events.push({ linkId: 'htl_winner', kind: 'create_ticket', payload: {}, status: 'pending' });
              throw Object.assign(new Error('unique'), { code: 'P2002' });
            }),
          },
        });
        return result;
      }
      return fn(mockDb);
    });

    await expect(service.onCheckResult(check({ connectionId: 'icn_a', passed: false }))).resolves.toBe('none');
    expect(events.filter((e) => e.kind === 'create_ticket')).toHaveLength(1);
    expect(mockDb.$transaction).toHaveBeenCalledTimes(2);
  });

  it('reuses the ref token of a pending_create link whose create died, and searches first', async () => {
    mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
    links.set('htl_1', {
      id: 'htl_1',
      organizationId: 'org_1',
      dedupKey: 'integration_check_failed:icn_a:aws-s3-public',
      refToken: 'CAI-KEEP',
      state: 'pending_create',
      haloTicketId: null,
      resolvedAt: null,
    });

    await expect(service.onCheckResult(check({ connectionId: 'icn_a', passed: false }))).resolves.toBe('create');
    expect(links.get('htl_1')?.refToken).toBe('CAI-KEEP');
    expect(events[0]).toMatchObject({ kind: 'create_ticket', payload: { searchFirst: true } });
    expect(String(events[0].payload.summary)).toContain('CAI-KEEP');
  });
});
