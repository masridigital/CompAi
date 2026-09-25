import { z } from 'zod';
import type { HaloConfig } from './config';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Refresh this many ms before the token's expiry. */
export const TOKEN_REFRESH_SKEW_MS = 60_000;

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().positive().default(3600),
  token_type: z.string().optional(),
});

export class HaloAuthError extends Error {
  readonly status?: number;

  constructor({ message, status }: { message: string; status?: number }) {
    super(message);
    this.name = 'HaloAuthError';
    this.status = status;
  }
}

export interface HaloTokenProvider {
  /** Return a valid bearer token, fetching or refreshing it when needed. */
  getToken: () => Promise<string>;
  /** Drop the cached token (e.g. after a 401). */
  invalidate: () => void;
}

export function buildTokenUrl(config: HaloConfig): string {
  const url = `${config.authUrl}/token`;
  if (!config.tenant) return url;
  return `${url}?tenant=${encodeURIComponent(config.tenant)}`;
}

/**
 * Client-credentials token provider.
 *
 * - Caches the token until {@link TOKEN_REFRESH_SKEW_MS} before `expires_in`.
 * - Single-flight: concurrent callers during a refresh share one token request.
 */
export function createTokenProvider({
  config,
  fetchImpl,
  now = Date.now,
}: {
  config: HaloConfig;
  fetchImpl: FetchLike;
  now?: () => number;
}): HaloTokenProvider {
  let cached: { token: string; refreshAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  const requestToken = async (): Promise<string> => {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: config.scope,
    });

    const response = await fetchImpl(buildTokenUrl(config), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new HaloAuthError({
        message:
          `HaloPSA token request failed (HTTP ${response.status}). Check HALOPSA_CLIENT_ID, HALOPSA_CLIENT_SECRET, HALOPSA_AUTH_URL, HALOPSA_TENANT and HALOPSA_SCOPE. ${text.slice(0, 200)}`.trim(),
        status: response.status,
      });
    }

    const parsed = TokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new HaloAuthError({
        message: 'HaloPSA token response did not include an access_token.',
      });
    }

    const lifetimeMs = parsed.data.expires_in * 1000;
    cached = {
      token: parsed.data.access_token,
      refreshAt: now() + Math.max(0, lifetimeMs - TOKEN_REFRESH_SKEW_MS),
    };
    return parsed.data.access_token;
  };

  const getToken = async (): Promise<string> => {
    if (cached && now() < cached.refreshAt) return cached.token;
    if (inflight) return inflight;

    inflight = requestToken().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  const invalidate = () => {
    cached = null;
  };

  return { getToken, invalidate };
}
