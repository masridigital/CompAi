import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { createTokenProvider } from '../auth';
import { computeRetryDelay, createHaloHttp, HALO_PAGE_SIZE, HaloApiError } from '../http';
import { createMockFetch, jsonResponse, TEST_CONFIG } from './test-utils';

function setup(handler: Parameters<typeof createMockFetch>[0], { maxRetries = 3 } = {}) {
  const mock = createMockFetch(handler);
  const sleeps: number[] = [];
  const tokens = createTokenProvider({ config: TEST_CONFIG, fetchImpl: mock.fetch });
  const http = createHaloHttp({
    config: TEST_CONFIG,
    tokens,
    fetchImpl: mock.fetch,
    maxRetries,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { http, mock, sleeps };
}

const Item = z.looseObject({ id: z.number() });
const items = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: from + i }));

describe('HaloHttp.request', () => {
  it('sends Bearer auth and JSON to the /api base', async () => {
    const { http, mock } = setup(() => jsonResponse({ ok: true }));
    await http.post('/Tickets', [{ id: 1 }]);
    const call = mock.apiCalls()[0];
    expect(call.url).toBe('https://halo.test/api/Tickets');
    expect(call.headers.Authorization).toBe('Bearer tok-1');
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(call.body).toBe('[{"id":1}]');
  });

  it('retries 429 honouring Retry-After seconds', async () => {
    let n = 0;
    const { http, sleeps } = setup(() =>
      ++n === 1
        ? jsonResponse({}, { status: 429, headers: { 'Retry-After': '2' } })
        : jsonResponse({ ok: 1 }),
    );
    expect(await http.get('/Client')).toEqual({ ok: 1 });
    expect(sleeps).toEqual([2000]);
  });

  it('retries 5xx with exponential backoff then gives up', async () => {
    const { http, sleeps, mock } = setup(() => jsonResponse({ msg: 'down' }, { status: 503 }), {
      maxRetries: 2,
    });
    const err = await http.get('/Client').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HaloApiError);
    expect((err as HaloApiError).status).toBe(503);
    expect(sleeps).toEqual([500, 1000]);
    expect(mock.apiCalls()).toHaveLength(3);
  });

  it('does not retry 4xx other than 429', async () => {
    const { http, mock } = setup(() => jsonResponse({}, { status: 404 }));
    const err = await http.get('/Client/9').catch((e: unknown) => e);
    expect((err as HaloApiError).status).toBe(404);
    expect(mock.apiCalls()).toHaveLength(1);
  });

  it('refreshes the token once on 401', async () => {
    let n = 0;
    const { http, mock } = setup(() =>
      ++n === 1 ? jsonResponse({}, { status: 401 }) : jsonResponse({ ok: 1 }),
    );
    expect(await http.get('/Client')).toEqual({ ok: 1 });
    expect(mock.calls.filter((c) => c.url.includes('/auth/token'))).toHaveLength(2);
  });

  it('retries network errors', async () => {
    let n = 0;
    const { http } = setup(() => {
      if (++n === 1) throw new TypeError('fetch failed');
      return jsonResponse([]);
    });
    expect(await http.get('/Team')).toEqual([]);
  });
});

describe('computeRetryDelay', () => {
  it('parses an HTTP-date Retry-After', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(
      computeRetryDelay({
        attempt: 0,
        retryAfter: 'Thu, 01 Jan 2026 00:00:05 GMT',
        now: () => now,
      }),
    ).toBe(5000);
  });

  it('caps the delay', () => {
    expect(computeRetryDelay({ attempt: 20, retryAfter: null })).toBe(30_000);
    expect(computeRetryDelay({ attempt: 0, retryAfter: '600' })).toBe(30_000);
  });
});

describe('HaloHttp.getAllPages', () => {
  it('pages with pageinate/page_size/page_no until record_count is reached', async () => {
    const { http, mock } = setup((url) => {
      const page = Number(url.searchParams.get('page_no'));
      const data = page === 1 ? items(1, HALO_PAGE_SIZE) : items(101, 20);
      return jsonResponse({ record_count: 120, tickets: data });
    });

    const result = await http.getAllPages({
      path: '/Tickets',
      query: { client_id: 5, skip: undefined },
      itemsKey: 'tickets',
      schema: Item,
    });

    expect(result).toHaveLength(120);
    const urls = mock.apiCalls().map((c) => new URL(c.url));
    expect(urls).toHaveLength(2);
    expect(urls[0].searchParams.get('pageinate')).toBe('true');
    expect(urls[0].searchParams.get('page_size')).toBe('100');
    expect(urls[0].searchParams.get('page_no')).toBe('1');
    expect(urls[1].searchParams.get('page_no')).toBe('2');
    expect(urls[0].searchParams.get('client_id')).toBe('5');
    expect(urls[0].searchParams.has('skip')).toBe(false);
  });

  it('stops at record_count even when the last page is full', async () => {
    const { http, mock } = setup(() => jsonResponse({ record_count: 100, clients: items(1, 100) }));
    const result = await http.getAllPages({ path: '/Client', itemsKey: 'clients', schema: Item });
    expect(result).toHaveLength(100);
    expect(mock.apiCalls()).toHaveLength(1);
  });

  it('respects maxPages', async () => {
    const { http, mock } = setup(() =>
      jsonResponse({ record_count: 10_000, tickets: items(1, 100) }),
    );
    const result = await http.getAllPages({
      path: '/Tickets',
      itemsKey: 'tickets',
      schema: Item,
      maxPages: 3,
    });
    expect(result).toHaveLength(300);
    expect(mock.apiCalls()).toHaveLength(3);
  });

  it('accepts a bare-array response', async () => {
    const { http } = setup(() => jsonResponse(items(1, 3)));
    expect(await http.getAllPages({ path: '/Team', itemsKey: 'teams', schema: Item })).toHaveLength(
      3,
    );
  });
});
