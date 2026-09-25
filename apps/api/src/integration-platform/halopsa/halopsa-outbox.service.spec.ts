const mockDb = {
  haloOutboxEvent: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  haloTicketLink: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
};

jest.mock('@db', () => ({ db: mockDb }));
jest.mock('./halopsa-connection', () => ({
  resolveMappingForConnection: jest.fn().mockReturnValue({ haloClientId: 42, haloSiteId: 7 }),
}));

import type { HaloClient } from '@trycompai/integration-platform';
import { HaloApiError } from '@trycompai/integration-platform';
import { backoffDelayMs, HaloOutboxService } from './halopsa-outbox.service';

const NOW = new Date('2026-09-25T12:00:00.000Z');

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hob_1',
    organizationId: 'org_1',
    linkId: 'htl_1',
    kind: 'create_ticket',
    payload: { summary: '[CompAI] x [CAI-AAAAAAAA]', details: '<p>x</p>', priorityId: 3 },
    status: 'processing',
    attempts: 0,
    nextAttemptAt: NOW,
    lastError: null,
    createdAt: NOW,
    ...overrides,
  };
}

const link = (overrides: Record<string, unknown> = {}) => ({
  id: 'htl_1',
  organizationId: 'org_1',
  connectionId: 'icn_1',
  refToken: 'CAI-AAAAAAAA',
  haloTicketId: null,
  state: 'pending_create',
  resolvedAt: null,
  connection: { id: 'icn_1', metadata: {}, variables: {} },
  ...overrides,
});

function fakeClient(overrides: Partial<Record<keyof HaloClient, jest.Mock>> = {}): HaloClient {
  return {
    createTicket: jest.fn().mockResolvedValue(900),
    searchTickets: jest.fn().mockResolvedValue([]),
    addAction: jest.fn().mockResolvedValue(1),
    setStatus: jest.fn().mockResolvedValue(undefined),
    getTicket: jest.fn().mockResolvedValue({ id: 55, status_id: 2 }),
    updateClientCustomFields: jest.fn().mockResolvedValue(undefined),
    attachToTicket: jest.fn().mockResolvedValue(5),
    ...overrides,
  } as unknown as HaloClient;
}

/** The guarded final write (updateMany on id + status processing + lease). */
const lastUpdate = () => {
  const calls = mockDb.haloOutboxEvent.updateMany.mock.calls;
  return calls[calls.length - 1][0].data;
};

describe('HaloOutboxService', () => {
  const service = new HaloOutboxService();

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.HALOPSA_OUTBOX_PAUSED;
    mockDb.haloOutboxEvent.updateMany.mockResolvedValue({ count: 1 });
    mockDb.haloTicketLink.findUnique.mockImplementation(({ include, select }) =>
      include ? link() : select ? { state: 'pending_create' } : link(),
    );
  });

  it('uses the 30s, 2m, 10m, 1h, 6h backoff and caps at 6h', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(backoffDelayMs)).toEqual([
      30_000, 120_000, 600_000, 3_600_000, 21_600_000, 21_600_000, 21_600_000,
    ]);
  });

  it('does nothing while paused', async () => {
    process.env.HALOPSA_OUTBOX_PAUSED = 'true';
    const result = await service.drain({ now: NOW, client: fakeClient() });
    expect(result.paused).toBe(true);
    expect(mockDb.haloOutboxEvent.findMany).not.toHaveBeenCalled();
  });

  it('creates the ticket and opens the link', async () => {
    const client = fakeClient();
    await expect(service.processEvent({ event: event() as never, client, now: NOW })).resolves.toBe('done');
    expect(client.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 42, siteId: 7, priorityId: 3 }),
    );
    expect(client.searchTickets).not.toHaveBeenCalled();
    expect(mockDb.haloTicketLink.update.mock.calls[0][0].data).toEqual({ haloTicketId: 900, state: 'open' });
    expect(lastUpdate()).toEqual({ status: 'done', lastError: null });
    const calls = mockDb.haloOutboxEvent.updateMany.mock.calls;
    expect(calls[calls.length - 1][0].where).toEqual({ id: 'hob_1', status: 'processing', nextAttemptAt: NOW });
  });

  it('marks a network failure on create as ambiguous and backs off', async () => {
    const client = fakeClient({ createTicket: jest.fn().mockRejectedValue(new Error('socket hang up')) });
    await expect(service.processEvent({ event: event() as never, client, now: NOW })).resolves.toBe('retried');
    const update = lastUpdate();
    expect(update.status).toBe('pending');
    expect(update.attempts).toBe(1);
    expect(update.lastError).toMatch(/^ambiguous: /);
    expect(update.nextAttemptAt).toEqual(new Date(NOW.getTime() + 30_000));
  });

  it('searches by ref token before retrying an ambiguous create and adopts the ticket', async () => {
    const client = fakeClient({
      searchTickets: jest.fn().mockResolvedValue([{ id: 777, summary: '[CompAI] x [CAI-AAAAAAAA]' }]),
    });
    const retry = event({ attempts: 1, lastError: 'ambiguous: socket hang up' });
    await expect(service.processEvent({ event: retry as never, client, now: NOW })).resolves.toBe('done');
    expect(client.searchTickets).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 42, search: 'CAI-AAAAAAAA' }),
    );
    expect(client.createTicket).not.toHaveBeenCalled();
    expect(mockDb.haloTicketLink.update.mock.calls[0][0].data.haloTicketId).toBe(777);
  });

  it('does not treat a 4xx rejection as ambiguous', async () => {
    const client = fakeClient({
      createTicket: jest.fn().mockRejectedValue(new HaloApiError({ status: 400, path: '/Tickets', body: 'bad' })),
    });
    await service.processEvent({ event: event() as never, client, now: NOW });
    expect(lastUpdate().lastError).not.toMatch(/^ambiguous/);
  });

  it('goes dead after 8 attempts', async () => {
    const client = fakeClient({ createTicket: jest.fn().mockRejectedValue(new Error('down')) });
    const outcome = await service.processEvent({ event: event({ attempts: 7 }) as never, client, now: NOW });
    expect(outcome).toBe('dead');
    expect(lastUpdate()).toMatchObject({ status: 'dead', attempts: 8 });
  });

  it('defers a note until the ticket exists, without spending an attempt', async () => {
    const note = event({ kind: 'add_note', payload: { note: '<p>again</p>' } });
    const outcome = await service.processEvent({ event: note as never, client: fakeClient(), now: NOW });
    expect(outcome).toBe('deferred');
    expect(lastUpdate().attempts).toBeUndefined();
    expect(lastUpdate().status).toBe('pending');
  });

  it('records the previous status before resolving', async () => {
    mockDb.haloTicketLink.findUnique.mockResolvedValue(link({ haloTicketId: 55, state: 'resolved' }));
    const client = fakeClient();
    const resolve = event({ kind: 'set_status', payload: { statusId: 9, note: '<p>ok</p>' } });
    await expect(service.processEvent({ event: resolve as never, client, now: NOW })).resolves.toBe('done');
    expect(mockDb.haloOutboxEvent.update.mock.calls[0][0].data.payload.previousStatusId).toBe(2);
    expect(client.addAction).toHaveBeenCalledWith({ ticketId: 55, note: '<p>ok</p>' });
    expect(client.setStatus).toHaveBeenCalledWith({ ticketId: 55, statusId: 9 });
  });

  it('reopens by restoring the pre-resolve status', async () => {
    mockDb.haloTicketLink.findUnique.mockResolvedValue(link({ haloTicketId: 55, state: 'open' }));
    mockDb.haloOutboxEvent.findMany.mockResolvedValue([
      { payload: { statusId: 9, previousStatusId: 2 } },
    ]);
    const client = fakeClient();
    const reopen = event({
      kind: 'reopen',
      payload: { note: '<p>again</p>', fallback: { summary: 's [CAI-AAAAAAAA]', details: 'd' } },
    });
    await expect(service.processEvent({ event: reopen as never, client, now: NOW })).resolves.toBe('done');
    expect(client.setStatus).toHaveBeenCalledWith({ ticketId: 55, statusId: 2 });
    expect(client.createTicket).not.toHaveBeenCalled();
  });

  it('pushes client custom fields to the mapped Halo client', async () => {
    mockDb.haloTicketLink.findUnique.mockResolvedValue(link({ state: 'open', entityType: 'posture' }));
    const client = fakeClient();
    const push = event({ kind: 'push_custom_fields', payload: { fields: { CFCompAIScore: 80 } } });
    await expect(service.processEvent({ event: push as never, client, now: NOW })).resolves.toBe('done');
    expect(client.updateClientCustomFields).toHaveBeenCalledWith({ clientId: 42, fields: { CFCompAIScore: 80 } });
  });

  it('attaches a file once earlier events are sent', async () => {
    mockDb.haloTicketLink.findUnique.mockResolvedValue(link({ haloTicketId: 55, state: 'open' }));
    mockDb.haloOutboxEvent.count.mockResolvedValue(0);
    const client = fakeClient();
    const attach = event({ kind: 'attach_file', payload: { filename: 'r.pdf', base64: 'JVBERg==' } });
    await expect(service.processEvent({ event: attach as never, client, now: NOW })).resolves.toBe('done');
    expect(client.attachToTicket).toHaveBeenCalledWith({ ticketId: 55, filename: 'r.pdf', base64: 'JVBERg==' });
  });

  it('defers attach and ordered close while an earlier event is queued', async () => {
    mockDb.haloTicketLink.findUnique.mockResolvedValue(link({ haloTicketId: 55, state: 'open' }));
    mockDb.haloOutboxEvent.count.mockResolvedValue(1);
    const client = fakeClient();
    const attach = event({ kind: 'attach_file', payload: { filename: 'r.pdf', base64: 'JVBERg==' } });
    await expect(service.processEvent({ event: attach as never, client, now: NOW })).resolves.toBe('deferred');
    const close = event({ kind: 'set_status', payload: { statusId: 9, afterPrior: true, markLinkResolved: true } });
    await expect(service.processEvent({ event: close as never, client, now: NOW })).resolves.toBe('deferred');
    expect(client.attachToTicket).not.toHaveBeenCalled();
    expect(client.setStatus).not.toHaveBeenCalled();
  });

  it('marks a report link resolved after its ordered close', async () => {
    mockDb.haloTicketLink.findUnique.mockResolvedValue(link({ haloTicketId: 55, state: 'open' }));
    mockDb.haloOutboxEvent.count.mockResolvedValue(0);
    const close = event({ kind: 'set_status', payload: { statusId: 9, afterPrior: true, markLinkResolved: true } });
    await expect(service.processEvent({ event: close as never, client: fakeClient(), now: NOW })).resolves.toBe('done');
    expect(mockDb.haloTicketLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'htl_1', state: 'open' } }),
    );
  });

  it('retries a dead event and reports its organization for the audit row', async () => {
    mockDb.haloOutboxEvent.findFirst.mockResolvedValue({ organizationId: 'org_1' });
    await expect(service.retry({ id: 'hob_1', now: NOW })).resolves.toEqual({
      id: 'hob_1',
      status: 'pending',
      organizationId: 'org_1',
    });
    expect(mockDb.haloOutboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'hob_1', status: 'dead' },
      data: { status: 'pending', attempts: 0, nextAttemptAt: NOW },
    });
  });
});
