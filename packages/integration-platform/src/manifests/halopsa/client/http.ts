import type { z } from 'zod';
import type { FetchLike, HaloTokenProvider } from './auth';
import type { HaloConfig } from './config';

export const HALO_PAGE_SIZE = 100;
const DEFAULT_MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

export type QueryValue = string | number | boolean | undefined;
export type HaloQuery = Record<string, QueryValue>;

export class HaloApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body: string;

  constructor({ status, path, body }: { status: number; path: string; body: string }) {
    super(`HaloPSA API ${path} failed with HTTP ${status}${body ? `: ${body.slice(0, 300)}` : ''}`);
    this.name = 'HaloApiError';
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

export interface HaloRequest {
  method?: 'GET' | 'POST' | 'DELETE';
  /** Path relative to `${baseUrl}/api`, e.g. `/Tickets`. */
  path: string;
  query?: HaloQuery;
  body?: unknown;
}

export interface HaloPageRequest<T> {
  path: string;
  query?: HaloQuery;
  /** Key holding the records in a paged response, e.g. `tickets`, `clients`. */
  itemsKey: string;
  schema: z.ZodType<T>;
  /** Safety cap on the number of pages fetched. Default 50 (5,000 records). */
  maxPages?: number;
}

export interface HaloHttp {
  request: (req: HaloRequest) => Promise<unknown>;
  get: (path: string, query?: HaloQuery) => Promise<unknown>;
  post: (path: string, body: unknown) => Promise<unknown>;
  getAllPages: <T>(req: HaloPageRequest<T>) => Promise<T[]>;
}

export type SleepFn = (ms: number) => Promise<void>;
const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Delay before the next retry: Retry-After (seconds or HTTP date) or exponential backoff. */
export function computeRetryDelay({
  attempt,
  retryAfter,
  now = Date.now,
}: {
  attempt: number;
  retryAfter: string | null;
  now?: () => number;
}): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.min(Math.max(0, date - now()), MAX_BACKOFF_MS);
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function buildUrl({ apiBase, path, query }: { apiBase: string; path: string; query?: HaloQuery }) {
  const url = new URL(`${apiBase}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Extract records from a Halo list response (either a bare array or `{ [itemsKey]: [...] }`). */
export function extractItems({ data, itemsKey }: { data: unknown; itemsKey: string }): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const items = (data as Record<string, unknown>)[itemsKey];
    if (Array.isArray(items)) return items;
  }
  return [];
}

function extractRecordCount(data: unknown): number | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const count = (data as Record<string, unknown>).record_count;
  return typeof count === 'number' ? count : undefined;
}

export function createHaloHttp({
  config,
  tokens,
  fetchImpl,
  sleep = defaultSleep,
  maxRetries = DEFAULT_MAX_RETRIES,
  now = Date.now,
}: {
  config: HaloConfig;
  tokens: HaloTokenProvider;
  fetchImpl: FetchLike;
  sleep?: SleepFn;
  maxRetries?: number;
  now?: () => number;
}): HaloHttp {
  const apiBase = `${config.baseUrl}/api`;

  const request = async ({ method = 'GET', path, query, body }: HaloRequest): Promise<unknown> => {
    const url = buildUrl({ apiBase, path, query });
    let refreshedAfter401 = false;

    for (let attempt = 0; ; attempt++) {
      const token = await tokens.getToken();
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      };

      let response: Response;
      try {
        response = await fetchImpl(url, init);
      } catch (err) {
        if (attempt >= maxRetries) throw err;
        await sleep(computeRetryDelay({ attempt, retryAfter: null, now }));
        continue;
      }

      if (response.ok) return parseBody(response);

      if (response.status === 401 && !refreshedAfter401) {
        refreshedAfter401 = true;
        tokens.invalidate();
        attempt--;
        continue;
      }

      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        await sleep(
          computeRetryDelay({ attempt, retryAfter: response.headers.get('retry-after'), now }),
        );
        continue;
      }

      const text = await response.text().catch(() => '');
      throw new HaloApiError({ status: response.status, path, body: text });
    }
  };

  const getAllPages = async <T>({
    path,
    query,
    itemsKey,
    schema,
    maxPages = 50,
  }: HaloPageRequest<T>): Promise<T[]> => {
    const results: T[] = [];

    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
      const data = await request({
        path,
        query: { ...query, pageinate: true, page_size: HALO_PAGE_SIZE, page_no: pageNo },
      });
      const items = extractItems({ data, itemsKey });
      for (const item of items) results.push(schema.parse(item));

      const recordCount = extractRecordCount(data);
      if (items.length < HALO_PAGE_SIZE) break;
      if (recordCount !== undefined && results.length >= recordCount) break;
    }

    return results;
  };

  return {
    request,
    get: (path, query) => request({ method: 'GET', path, query }),
    post: (path, body) => request({ method: 'POST', path, body }),
    getAllPages,
  };
}
