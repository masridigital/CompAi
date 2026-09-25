import { beforeEach, describe, expect, it } from 'bun:test';
import { createHaloClient, resetHaloTokenCache } from '../index';
import {
  HaloClientSchema,
  HaloPrioritySchema,
  HaloTicketSchema,
  parseHaloDate,
  ticketClosedAt,
} from '../schemas';
import {
  createMockFetch,
  jsonResponse,
  noSleep,
  TEST_CONFIG,
  type RecordedCall,
} from './test-utils';

function client(handler: (url: URL, call: RecordedCall) => Response) {
  const mock = createMockFetch(handler);
  const halo = createHaloClient({ config: TEST_CONFIG, fetchImpl: mock.fetch, sleep: noSleep });
  return { halo, mock };
}

const body = (call: RecordedCall) => JSON.parse(call.body ?? 'null');

beforeEach(() => resetHaloTokenCache());

describe('schemas', () => {
  it('keeps unknown fields and coerces ids', () => {
    const parsed = HaloClientSchema.parse({ id: '42', name: 'Acme', colour: 'red' });
    expect(parsed.id).toBe(42);
    expect(parsed.colour).toBe('red');
  });

  it('accepts priorities keyed by priorityid', () => {
    expect(HaloPrioritySchema.parse({ priorityid: 3, name: 'P3' }).priorityid).toBe(3);
  });

  it('rejects records without an id', () => {
    expect(HaloTicketSchema.safeParse({ summary: 'x' }).success).toBe(false);
  });

  it('treats 1900 dates as null and zone-less dates as UTC', () => {
    expect(parseHaloDate('1900-01-01T00:00:00')).toBeNull();
    expect(parseHaloDate('2026-03-01T10:00:00')?.toISOString()).toBe('2026-03-01T10:00:00.000Z');
    expect(parseHaloDate('garbage')).toBeNull();
    const ticket = HaloTicketSchema.parse({ id: 1, datecleared: '2026-03-02T00:00:00Z' });
    expect(ticketClosedAt(ticket)?.toISOString()).toBe('2026-03-02T00:00:00.000Z');
  });
});

describe('tickets', () => {
  it('createTicket posts an array with Halo field names and returns the id', async () => {
    const { halo, mock } = client(() => jsonResponse({ id: 555 }));
    const id = await halo.createTicket({
      clientId: 7,
      siteId: 8,
      summary: 'Check failing',
      details: '<p>details</p>',
      ticketTypeId: 21,
      teamId: 3,
      agentId: 4,
      priorityId: 2,
    });
    expect(id).toBe(555);
    const call = mock.apiCalls()[0];
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://halo.test/api/Tickets');
    expect(body(call)).toEqual([
      {
        client_id: 7,
        site_id: 8,
        summary: 'Check failing',
        details: '<p>details</p>',
        tickettype_id: 21,
        team_id: 3,
        agent_id: 4,
        priority_id: 2,
      },
    ]);
  });

  it('createTicket accepts an array response', async () => {
    const { halo } = client(() => jsonResponse([{ id: 9 }]));
    expect(await halo.createTicket({ clientId: 1, summary: 's', details: 'd' })).toBe(9);
  });

  it('addAction posts a private note without email', async () => {
    const { halo, mock } = client(() => jsonResponse({ id: 77 }));
    expect(await halo.addAction({ ticketId: 555, note: 'Still failing' })).toBe(77);
    const call = mock.apiCalls()[0];
    expect(call.url).toBe('https://halo.test/api/Actions');
    expect(body(call)).toEqual([
      {
        ticket_id: 555,
        note: 'Still failing',
        outcome: 'Private Note',
        hiddenfromuser: true,
        sendemail: false,
      },
    ]);
  });

  it('setStatus posts id + status_id', async () => {
    const { halo, mock } = client(() => jsonResponse({ id: 555 }));
    await halo.setStatus({ ticketId: 555, statusId: 9 });
    expect(body(mock.apiCalls()[0])).toEqual([{ id: 555, status_id: 9 }]);
  });

  it('searchTickets sends filters and drops other clients / types', async () => {
    const { halo, mock } = client(() =>
      jsonResponse({
        record_count: 3,
        tickets: [
          { id: 1, client_id: 7, tickettype_id: 21 },
          { id: 2, client_id: 8, tickettype_id: 21 },
          { id: 3, client_id: 7, tickettype_id: 99 },
        ],
      }),
    );
    const tickets = await halo.searchTickets({
      clientId: 7,
      search: 'phish',
      open: true,
      ticketTypeIds: [21],
    });
    expect(tickets.map((t) => t.id)).toEqual([1]);
    const url = new URL(mock.apiCalls()[0].url);
    expect(url.pathname).toBe('/api/Tickets');
    expect(url.searchParams.get('client_id')).toBe('7');
    expect(url.searchParams.get('search')).toBe('phish');
    expect(url.searchParams.get('open_only')).toBe('true');
    expect(url.searchParams.get('requesttype')).toBe('21');
  });

  it('getTicket reads /Tickets/{id}', async () => {
    const { halo, mock } = client(() => jsonResponse({ id: 5, summary: 'x' }));
    expect((await halo.getTicket(5)).summary).toBe('x');
    expect(new URL(mock.apiCalls()[0].url).pathname).toBe('/api/Tickets/5');
  });
});

describe('clients, meta and custom fields', () => {
  it('listClients filters inactive clients', async () => {
    const { halo, mock } = client(() =>
      jsonResponse({
        record_count: 2,
        clients: [
          { id: 1, name: 'A' },
          { id: 2, name: 'B', inactive: true },
        ],
      }),
    );
    expect((await halo.listClients()).map((c) => c.id)).toEqual([1]);
    expect(new URL(mock.apiCalls()[0].url).searchParams.get('includeinactive')).toBe('false');
  });

  it('getClient reads /Client/{id}', async () => {
    const { halo } = client(() => jsonResponse({ id: 42, name: 'Acme' }));
    expect((await halo.getClient(42)).name).toBe('Acme');
  });

  it('lists lookups from arrays or keyed objects', async () => {
    const { halo } = client((url) => {
      if (url.pathname.endsWith('/Team')) return jsonResponse([{ id: 1, name: 'SOC' }]);
      if (url.pathname.endsWith('/Status'))
        return jsonResponse({ statuses: [{ id: 9, name: 'Closed', type: 4 }] });
      return jsonResponse([]);
    });
    expect(await halo.listTeams()).toHaveLength(1);
    expect((await halo.listStatuses())[0].name).toBe('Closed');
    expect(await halo.listAgents()).toEqual([]);
  });

  it('updateClientCustomFields posts id + customfields', async () => {
    const { halo, mock } = client(() => jsonResponse({ id: 42 }));
    await halo.updateClientCustomFields({
      clientId: 42,
      fields: { CFCompAIScore: 87, CFCompAIUrl: 'https://x' },
    });
    const call = mock.apiCalls()[0];
    expect(call.url).toBe('https://halo.test/api/Client');
    expect(body(call)).toEqual([
      {
        id: 42,
        customfields: [
          { name: 'CFCompAIScore', value: 87 },
          { name: 'CFCompAIUrl', value: 'https://x' },
        ],
      },
    ]);
  });

  it('updateClientCustomFields is a no-op for no fields', async () => {
    const { halo, mock } = client(() => jsonResponse({}));
    await halo.updateClientCustomFields({ clientId: 42, fields: {} });
    expect(mock.calls).toHaveLength(0);
  });
});
