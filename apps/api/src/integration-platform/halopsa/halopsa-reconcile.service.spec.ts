const mockDb = {
  haloTicketLink: { findMany: jest.fn(), update: jest.fn() },
};

jest.mock('@db', () => ({ db: mockDb }));
jest.mock('./halopsa-closed-handler', () => ({
  handleHaloTicketClosed: jest.fn().mockResolvedValue('closed'),
}));

import { HaloApiError, type HaloClient } from '@trycompai/integration-platform';
import { handleHaloTicketClosed } from './halopsa-closed-handler';
import { HaloReconcileService } from './halopsa-reconcile.service';

const NOW = new Date('2026-09-25T12:00:00.000Z');
const link = (id: string, haloTicketId: number) => ({ id, haloTicketId, state: 'open' });

describe('HaloReconcileService', () => {
  const service = new HaloReconcileService();

  beforeEach(() => jest.clearAllMocks());

  it('polls the least recently reconciled open links first (never-polled first)', async () => {
    mockDb.haloTicketLink.findMany.mockResolvedValue([]);
    await service.reconcile({ client: {} as HaloClient, now: NOW, batchSize: 2 });
    expect(mockDb.haloTicketLink.findMany).toHaveBeenCalledWith({
      where: { state: 'open', haloTicketId: { not: null } },
      orderBy: [{ lastReconciledAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: 2,
    });
  });

  it('stamps every polled link, including failures, so later runs reach the rest', async () => {
    mockDb.haloTicketLink.findMany.mockResolvedValue([link('a', 1), link('b', 2)]);
    const client = {
      getTicket: jest
        .fn()
        .mockResolvedValueOnce({ id: 1, hasbeenclosed: false })
        .mockRejectedValueOnce(new HaloApiError({ status: 500, path: '/Tickets/2', body: '' })),
    } as unknown as HaloClient;

    const result = await service.reconcile({ client, now: NOW, batchSize: 2 });

    expect(result).toEqual({ checked: 2, closed: 0, errors: 1 });
    expect(mockDb.haloTicketLink.update.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: 'a' }, data: { lastReconciledAt: NOW } },
      { where: { id: 'b' }, data: { lastReconciledAt: NOW } },
    ]);
  });

  it('covers more than one batch of open links over successive runs', async () => {
    const all = [link('a', 1), link('b', 2), link('c', 3)];
    const stamped = new Map<string, Date>();
    mockDb.haloTicketLink.findMany.mockImplementation(async ({ take }: { take: number }) =>
      [...all]
        .sort((x, y) => (stamped.get(x.id)?.getTime() ?? -1) - (stamped.get(y.id)?.getTime() ?? -1))
        .slice(0, take),
    );
    mockDb.haloTicketLink.update.mockImplementation(
      async ({ where, data }: { where: { id: string }; data: { lastReconciledAt: Date } }) => {
        stamped.set(where.id, data.lastReconciledAt);
      },
    );
    const polled: number[] = [];
    const client = {
      getTicket: jest.fn(async (id: number) => {
        polled.push(id);
        return { id, hasbeenclosed: false };
      }),
    } as unknown as HaloClient;

    await service.reconcile({ client, now: new Date(1000), batchSize: 2 });
    await service.reconcile({ client, now: new Date(2000), batchSize: 2 });

    expect(new Set(polled)).toEqual(new Set([1, 2, 3]));
  });

  it('does not count links that were no longer open as closed', async () => {
    mockDb.haloTicketLink.findMany.mockResolvedValue([link('a', 1)]);
    (handleHaloTicketClosed as jest.Mock).mockResolvedValueOnce('not_open');
    const client = { getTicket: jest.fn().mockResolvedValue({ id: 1, hasbeenclosed: true }) } as unknown as HaloClient;
    await expect(service.reconcile({ client, now: NOW })).resolves.toEqual({ checked: 1, closed: 0, errors: 0 });
  });
});
