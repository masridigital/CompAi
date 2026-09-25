const mockDb = { organization: { findMany: jest.fn() } };
jest.mock('@db', () => ({ db: mockDb }));

const batchTriggerMock = jest.fn();
const triggerMock = jest.fn();
const idempotencyCreateMock = jest.fn(async (key: string) => `idem:${key}`);

jest.mock('@trigger.dev/sdk', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  queue: jest.fn(() => ({ name: 'q' })),
  task: (config: Record<string, unknown>) => ({
    ...config,
    batchTrigger: (...args: unknown[]) => batchTriggerMock(...args),
    trigger: (...args: unknown[]) => triggerMock(...args),
  }),
  schedules: { task: (config: unknown) => config },
  idempotencyKeys: {
    create: (key: string) => idempotencyCreateMock(key),
  },
}));

const pruneMock = jest.fn().mockResolvedValue(3);
jest.mock('./create-client-posture-service', () => ({
  createClientPostureService: () => ({ pruneSnapshots: pruneMock }),
}));
jest.mock('../../client-posture/client-posture.service', () => ({
  POSTURE_RETENTION_DAYS: 30,
}));

import {
  buildPostureBatches,
  clientPostureSchedule,
  runClientPostureFanOut,
} from './client-posture-schedule';
import {
  postureDebounceKey,
  triggerDebouncedClientPosture,
} from './compute-client-posture';

describe('client posture schedule', () => {
  beforeEach(() => jest.clearAllMocks());

  it('runs nightly at 05:30 UTC', () => {
    expect(clientPostureSchedule).toMatchObject({
      id: 'client-posture-schedule',
      cron: '30 5 * * *',
    });
  });

  it('chunks org ids into batchTrigger payloads', () => {
    const batches = buildPostureBatches({
      organizationIds: ['a', 'b', 'c'],
      batchSize: 2,
    });
    expect(batches).toEqual([
      [
        { payload: { organizationId: 'a' } },
        { payload: { organizationId: 'b' } },
      ],
      [{ payload: { organizationId: 'c' } }],
    ]);
  });

  it('fans out one run per org and prunes snapshots older than 30 days', async () => {
    const orgs = Array.from({ length: 150 }, (_, i) => ({ id: `org_${i}` }));
    mockDb.organization.findMany.mockResolvedValue(orgs);

    const result = await runClientPostureFanOut();

    expect(mockDb.organization.findMany).toHaveBeenCalledWith({
      where: { OR: [{ hasAccess: true }, { onboardingCompleted: true }] },
      select: { id: true },
    });
    expect(batchTriggerMock).toHaveBeenCalledTimes(2);
    expect(batchTriggerMock.mock.calls[0][0]).toHaveLength(100);
    expect(batchTriggerMock.mock.calls[1][0]).toHaveLength(50);
    expect(pruneMock).toHaveBeenCalledWith({ retentionDays: 30 });
    expect(result).toEqual({ orgsTriggered: 150, snapshotsPruned: 3 });
  });

  it('does nothing but prune when there are no orgs', async () => {
    mockDb.organization.findMany.mockResolvedValue([]);
    const result = await runClientPostureFanOut();
    expect(batchTriggerMock).not.toHaveBeenCalled();
    expect(result.orgsTriggered).toBe(0);
  });
});

describe('debounced per-org posture trigger', () => {
  beforeEach(() => jest.clearAllMocks());

  it('buckets the idempotency key into 10 minute windows', () => {
    const at = (iso: string) =>
      postureDebounceKey({ organizationId: 'org_1', now: new Date(iso) });
    expect(at('2026-09-25T10:01:00Z')).toBe(at('2026-09-25T10:09:59Z'));
    expect(at('2026-09-25T10:09:59Z')).not.toBe(at('2026-09-25T10:10:00Z'));
    expect(at('2026-09-25T10:01:00Z')).toMatch(/^client-posture:org_1:/);
  });

  it('triggers with a global idempotency key and 10m TTL', async () => {
    await triggerDebouncedClientPosture('org_1');
    expect(triggerMock).toHaveBeenCalledWith(
      { organizationId: 'org_1' },
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^idem:client-posture:org_1:/),
        idempotencyKeyTTL: '10m',
      }),
    );
  });

  it('never throws when triggering fails', async () => {
    triggerMock.mockRejectedValueOnce(new Error('boom'));
    await expect(
      triggerDebouncedClientPosture('org_1'),
    ).resolves.toBeUndefined();
  });
});
