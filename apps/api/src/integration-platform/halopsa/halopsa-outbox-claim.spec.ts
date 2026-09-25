const mockDb = {
  haloOutboxEvent: { findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  haloTicketLink: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
};

jest.mock('@db', () => ({ db: mockDb }));
jest.mock('./halopsa-connection', () => ({
  resolveMappingForConnection: jest.fn().mockReturnValue({ haloClientId: 42 }),
}));

import type { HaloClient } from '@trycompai/integration-platform';
import { claimOutboxBatch, finishClaimedEvent } from './halopsa-outbox-claim';
import { HaloOutboxService } from './halopsa-outbox.service';

const NOW = new Date('2026-09-25T12:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);

function event(overrides: Record<string, unknown>) {
  return {
    id: 'hob_1',
    organizationId: 'org_1',
    linkId: 'htl_1',
    kind: 'add_note',
    payload: { note: '<p>x</p>' },
    status: 'pending',
    attempts: 0,
    nextAttemptAt: NOW,
    lastError: null,
    createdAt: NOW,
    ...overrides,
  };
}

/** findMany #1 = due candidates, findMany #2 = every queued event for those links. */
function queue({ due, queued }: { due: unknown[]; queued: unknown[] }) {
  mockDb.haloOutboxEvent.findMany.mockResolvedValueOnce(due).mockResolvedValueOnce(queued);
}

describe('claimOutboxBatch ordering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.haloOutboxEvent.updateMany.mockResolvedValue({ count: 1 });
  });

  it('claims only events whose guarded update wins', async () => {
    const a = event({ id: 'a', linkId: 'l1' });
    const b = event({ id: 'b', linkId: 'l2' });
    queue({ due: [a, b], queued: [a, b] });
    mockDb.haloOutboxEvent.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const claimed = await claimOutboxBatch({ now: NOW });
    expect(claimed.map((e) => e.id)).toEqual(['a']);
    expect(mockDb.haloOutboxEvent.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'a', status: 'pending', nextAttemptAt: NOW },
      data: { status: 'processing' },
    });
  });

  it('never claims a note while an older create for the same link is backing off', async () => {
    const create = event({ id: 'c', kind: 'create_ticket', nextAttemptAt: at(60_000), createdAt: at(-2000) });
    const note = event({ id: 'n', kind: 'add_note', createdAt: at(-1000) });
    queue({ due: [note], queued: [create, note] });

    await expect(claimOutboxBatch({ now: NOW })).resolves.toEqual([]);
    expect(mockDb.haloOutboxEvent.updateMany).not.toHaveBeenCalled();
  });

  it('never claims a newer event while an older one is processing elsewhere', async () => {
    const running = event({ id: 'r', status: 'processing', nextAttemptAt: at(600_000), createdAt: at(-2000) });
    const status = event({ id: 's', kind: 'set_status', createdAt: at(-1000) });
    queue({ due: [status], queued: [running, status] });

    await expect(claimOutboxBatch({ now: NOW })).resolves.toEqual([]);
  });

  it('claims only the oldest event per link and keeps other links flowing', async () => {
    const first = event({ id: 'e1', linkId: 'l1', createdAt: at(-3000) });
    const second = event({ id: 'e2', linkId: 'l1', createdAt: at(-2000) });
    const other = event({ id: 'e3', linkId: 'l2', createdAt: at(-1000) });
    queue({ due: [first, second, other], queued: [first, second, other] });

    const claimed = await claimOutboxBatch({ now: NOW });
    expect(claimed.map((e) => e.id)).toEqual(['e1', 'e3']);
  });

  it('breaks createdAt ties by id', async () => {
    const x = event({ id: 'hob_b', createdAt: NOW });
    const y = event({ id: 'hob_a', createdAt: NOW });
    queue({ due: [x, y], queued: [x, y] });

    const claimed = await claimOutboxBatch({ now: NOW });
    expect(claimed.map((e) => e.id)).toEqual(['hob_a']);
  });
});

describe('guarded final writes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('only writes while the lease is still ours', async () => {
    mockDb.haloOutboxEvent.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      finishClaimedEvent({ event: { id: 'hob_1', nextAttemptAt: NOW }, data: { status: 'done' } }),
    ).resolves.toBe(false);
    expect(mockDb.haloOutboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'hob_1', status: 'processing', nextAttemptAt: NOW },
      data: { status: 'done' },
    });
  });

  it('drops the outcome of an event whose lease expired (no overwrite of a newer result)', async () => {
    mockDb.haloOutboxEvent.updateMany.mockResolvedValue({ count: 0 });
    mockDb.haloTicketLink.findUnique.mockResolvedValue({
      id: 'htl_1',
      haloTicketId: 55,
      state: 'open',
      connection: { metadata: {} },
    });
    const client = { addAction: jest.fn().mockResolvedValue(1) } as unknown as HaloClient;
    const service = new HaloOutboxService();

    const outcome = await service.processEvent({
      event: event({ status: 'processing' }) as never,
      client,
      now: NOW,
    });
    expect(outcome).toBe('lost');
    expect(mockDb.haloOutboxEvent.update).not.toHaveBeenCalled();
  });

  it('does not let a failure overwrite a newer outcome either', async () => {
    mockDb.haloOutboxEvent.updateMany.mockResolvedValue({ count: 0 });
    mockDb.haloTicketLink.findUnique.mockResolvedValue({
      id: 'htl_1',
      haloTicketId: 55,
      state: 'open',
      connection: { metadata: {} },
    });
    const client = { addAction: jest.fn().mockRejectedValue(new Error('down')) } as unknown as HaloClient;
    const outcome = await new HaloOutboxService().processEvent({
      event: event({ status: 'processing' }) as never,
      client,
      now: NOW,
    });
    expect(outcome).toBe('lost');
    expect(mockDb.haloOutboxEvent.updateMany.mock.calls[0][0].where.status).toBe('processing');
  });
});
