import { afterEach, beforeEach } from 'bun:test';
import type {
  CheckContext,
  CheckFindingResult,
  CheckPassingResult,
  CheckVariableValues,
} from '../../../../types';
import { resetHaloTokenCache } from '../../client';

export const HALO_ENV = {
  HALOPSA_BASE_URL: 'https://halo.test',
  HALOPSA_CLIENT_ID: 'cid',
  HALOPSA_CLIENT_SECRET: 'secret',
};

const HOUR = 3_600_000;
export const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

export interface RecordedCheck {
  ctx: CheckContext;
  passes: CheckPassingResult[];
  fails: CheckFindingResult[];
}

/** Admin-written binding metadata for Halo client 7. */
export const BOUND_METADATA = { halopsaBinding: { haloClientId: 7 } };

export function makeCtx({
  credentials = { managedBy: 'msp' },
  variables = {},
  metadata = BOUND_METADATA,
}: {
  credentials?: Record<string, string | string[]>;
  variables?: CheckVariableValues;
  metadata?: Record<string, unknown>;
} = {}): RecordedCheck {
  const passes: CheckPassingResult[] = [];
  const fails: CheckFindingResult[] = [];
  const notImplemented = () =>
    Promise.reject(new Error('ctx HTTP helpers are not used by HaloPSA checks'));
  const ctx: CheckContext = {
    accessToken: '',
    credentials,
    variables,
    connectionId: 'icn_test',
    organizationId: 'org_test',
    metadata,
    log: () => {},
    warn: () => {},
    error: () => {},
    pass: (r) => passes.push(r),
    fail: (f) => fails.push(f),
    addPassingResult: () => {},
    addFinding: () => {},
    fetch: notImplemented,
    post: notImplemented,
    put: notImplemented,
    patch: notImplemented,
    delete: notImplemented,
    graphql: notImplemented,
    fetchAllPages: notImplemented,
    fetchWithCursor: notImplemented,
    fetchWithLinkHeader: notImplemented,
    getState: async () => null,
    setState: async () => {},
  };
  return { ctx, passes, fails };
}

type Route = (url: URL) => unknown;

/**
 * Install HALOPSA_* env and a global fetch mock for the duration of each test.
 * `setRoutes` maps a path suffix (e.g. '/api/Tickets') to a JSON body.
 */
export function useHaloMock() {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  let routes: Record<string, Route> = {};
  const requests: URL[] = [];

  beforeEach(() => {
    resetHaloTokenCache();
    Object.assign(process.env, HALO_ENV);
    requests.length = 0;
    routes = {};
    const mockFetch = async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      requests.push(url);
      if (url.pathname.endsWith('/auth/token')) {
        return Response.json({ access_token: 'tok', expires_in: 3600 });
      }
      const route = Object.entries(routes).find(([suffix]) => url.pathname.endsWith(suffix));
      if (!route) return new Response('not found', { status: 404 });
      const result = route[1](url);
      if (result instanceof Response) return result;
      return Response.json(result);
    };
    globalThis.fetch = mockFetch as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(HALO_ENV)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });

  return {
    setRoutes: (next: Record<string, Route>) => {
      routes = next;
    },
    requests,
  };
}
