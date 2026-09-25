const mockDb = {
  integrationConnection: { findFirst: jest.fn(), update: jest.fn() },
  haloTicketLink: { findFirst: jest.fn() },
};

jest.mock('@db', () => ({ db: mockDb, Prisma: {} }));
jest.mock('./halopsa-closed-handler', () => ({
  handleHaloTicketClosed: jest.fn().mockResolvedValue('closed'),
}));

import { ServiceUnavailableException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { handleHaloTicketClosed } from './halopsa-closed-handler';
import { setHaloKvForTests, type HaloKv } from './halopsa-kv';
import { parseHaloWebhookBody } from './halopsa-webhook-payload';
import { bearerMatches, HaloWebhookService, sha256Hex } from './halopsa-webhook.service';

const TOKEN = 'a'.repeat(43);
const SECRET = 'webhook-secret';

function memoryKv(): HaloKv {
  const store = new Map<string, unknown>();
  const kv = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
  return kv as unknown as HaloKv;
}

describe('parseHaloWebhookBody', () => {
  it.each([
    [{ id: 12, hasbeenclosed: true }, 12],
    [{ ticket_id: '13', status: 'Closed' }, 13],
    [{ ticket: { id: 14, dateclosed: '2026-09-25T10:00:00' } }, 14],
  ])('reads ticket id and closed flag from %j', (body, id) => {
    const parsed = parseHaloWebhookBody(body);
    expect(parsed.ticketId).toBe(id);
    expect(parsed.closed).toBe(true);
  });

  it('returns unknown closed state and no id for junk', () => {
    expect(parseHaloWebhookBody({ id: 'abc' })).toMatchObject({ ticketId: null, closed: null });
    expect(parseHaloWebhookBody(null)).toMatchObject({ ticketId: null });
  });

  it('ignores 1900 dates and picks resolution / agent', () => {
    const parsed = parseHaloWebhookBody({
      ticket: { id: 5, dateclosed: '1900-01-01T00:00:00', closure_note: 'Fixed', agent_name: 'Sam' },
    });
    expect(parsed).toMatchObject({ ticketId: 5, closed: null, resolution: 'Fixed', agentName: 'Sam' });
  });
});

describe('bearerMatches', () => {
  it('accepts only the exact secret', () => {
    expect(bearerMatches({ header: `Bearer ${SECRET}`, secret: SECRET })).toBe(true);
    expect(bearerMatches({ header: `bearer ${SECRET}`, secret: SECRET })).toBe(true);
    expect(bearerMatches({ header: 'Bearer wrong', secret: SECRET })).toBe(false);
    expect(bearerMatches({ header: SECRET, secret: SECRET })).toBe(false);
    expect(bearerMatches({ header: undefined, secret: SECRET })).toBe(false);
  });
});

describe('HaloWebhookService', () => {
  const service = new HaloWebhookService();
  const link = { id: 'htl_1', organizationId: 'org_1', haloTicketId: 12 };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HALOPSA_WEBHOOK_SECRET = SECRET;
    setHaloKvForTests(memoryKv());
    mockDb.integrationConnection.findFirst.mockResolvedValue({ id: 'icn_1', organizationId: 'org_1' });
    mockDb.haloTicketLink.findFirst.mockResolvedValue(link);
  });

  afterAll(() => setHaloKvForTests(undefined));

  const call = (overrides: Partial<{ token: string; authorization: string; body: unknown }> = {}) =>
    service.handle({
      token: TOKEN,
      authorization: `Bearer ${SECRET}`,
      body: { id: 12, hasbeenclosed: true, closure_note: 'Done' },
      ...overrides,
    });

  it('rejects when no webhook secret is configured', async () => {
    delete process.env.HALOPSA_WEBHOOK_SECRET;
    await expect(call()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects a wrong bearer before touching the database', async () => {
    await expect(call({ authorization: 'Bearer nope' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mockDb.integrationConnection.findFirst).not.toHaveBeenCalled();
  });

  it('looks the connection up by the sha256 of the token', async () => {
    await call();
    expect(mockDb.integrationConnection.findFirst.mock.calls[0][0].where.metadata).toEqual({
      path: ['halopsaWebhookTokenHash'],
      equals: sha256Hex(TOKEN),
    });
  });

  it('404s for an unknown or malformed token', async () => {
    mockDb.integrationConnection.findFirst.mockResolvedValue(null);
    await expect(call()).rejects.toBeInstanceOf(NotFoundException);
    await expect(call({ token: 'short' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('drops replays of the same body', async () => {
    await expect(call()).resolves.toBe('closed');
    await expect(call()).resolves.toBe('duplicate');
    expect(handleHaloTicketClosed).toHaveBeenCalledTimes(1);
  });

  it('skips replay protection when KV is unavailable', async () => {
    setHaloKvForTests(null);
    await expect(call()).resolves.toBe('closed');
    await expect(call()).resolves.toBe('closed');
  });

  it('scopes the link lookup to the connection organization and applies closed handling', async () => {
    await call();
    expect(mockDb.haloTicketLink.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', haloTicketId: 12 },
    });
    expect(handleHaloTicketClosed).toHaveBeenCalledWith(
      expect.objectContaining({ link, ticketId: 12, resolution: 'Done' }),
    );
  });

  it('ignores tickets that are not ours or not closed', async () => {
    mockDb.haloTicketLink.findFirst.mockResolvedValueOnce(null);
    await expect(call()).resolves.toBe('unknown_ticket');
    await expect(call({ body: { id: 12, hasbeenclosed: false } })).resolves.toBe('not_closed');
    expect(handleHaloTicketClosed).not.toHaveBeenCalled();
  });

  it('issues a token once and stores only its hash', async () => {
    mockDb.integrationConnection.findFirst.mockResolvedValue({ id: 'icn_1', metadata: { keep: 1 } });
    const { token, url } = await service.issueToken({ connectionId: 'icn_1', organizationId: 'org_1' });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url).toMatch(new RegExp(`/v1/integrations/halopsa/webhooks/${token}$`));
    const metadata = mockDb.integrationConnection.update.mock.calls[0][0].data.metadata;
    expect(metadata).toMatchObject({ keep: 1, halopsaWebhookTokenHash: sha256Hex(token) });
    expect(JSON.stringify(metadata)).not.toContain(token);
  });
});
