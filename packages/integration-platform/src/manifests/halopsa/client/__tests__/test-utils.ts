import type { FetchLike } from '../auth';
import type { HaloConfig } from '../config';

export const TEST_CONFIG: HaloConfig = {
  baseUrl: 'https://halo.test',
  authUrl: 'https://halo.test/auth',
  tenant: 'masri',
  clientId: 'cid',
  clientSecret: 'secret',
  scope: 'read:tickets',
};

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export function jsonResponse(
  body: unknown,
  { status = 200, headers = {} }: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function tokenResponse(token = 'tok-1', expiresIn = 3600): Response {
  return jsonResponse({ access_token: token, expires_in: expiresIn, token_type: 'Bearer' });
}

/**
 * Fetch mock: `/auth/token` always returns a token; other requests are served
 * by `handler` (called with the parsed URL). Every call is recorded.
 */
export function createMockFetch(
  handler: (url: URL, call: RecordedCall) => Response | Promise<Response>,
): { fetch: FetchLike; calls: RecordedCall[]; apiCalls: () => RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (input, init) => {
    const call: RecordedCall = {
      url: input,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(call);
    const url = new URL(input);
    if (url.pathname.endsWith('/auth/token')) return tokenResponse();
    return handler(url, call);
  };
  return { fetch, calls, apiCalls: () => calls.filter((c) => !c.url.includes('/auth/token')) };
}

export const noSleep = async () => {};
