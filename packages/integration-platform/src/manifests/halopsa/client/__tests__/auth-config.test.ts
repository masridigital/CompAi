import { describe, expect, it } from 'bun:test';
import { buildTokenUrl, createTokenProvider, HaloAuthError, type FetchLike } from '../auth';
import {
  DEFAULT_HALOPSA_SCOPE,
  HaloConfigError,
  isHaloConfigured,
  loadHaloConfig,
} from '../config';
import { jsonResponse, TEST_CONFIG, tokenResponse } from './test-utils';

describe('loadHaloConfig', () => {
  const env = {
    HALOPSA_BASE_URL: 'https://portal.masri.tech/',
    HALOPSA_CLIENT_ID: 'id',
    HALOPSA_CLIENT_SECRET: 'secret',
  };

  it('applies defaults for auth URL and scope', () => {
    const config = loadHaloConfig(env);
    expect(config.baseUrl).toBe('https://portal.masri.tech');
    expect(config.authUrl).toBe('https://portal.masri.tech/auth');
    expect(config.scope).toBe(DEFAULT_HALOPSA_SCOPE);
    expect(config.tenant).toBeUndefined();
  });

  it('honours explicit auth URL, tenant and scope', () => {
    const config = loadHaloConfig({
      ...env,
      HALOPSA_AUTH_URL: 'https://auth.halopsa.com',
      HALOPSA_TENANT: 'masri',
      HALOPSA_SCOPE: 'all',
    });
    expect(config.authUrl).toBe('https://auth.halopsa.com');
    expect(config.tenant).toBe('masri');
    expect(config.scope).toBe('all');
  });

  it('names every missing variable', () => {
    try {
      loadHaloConfig({ HALOPSA_BASE_URL: '', HALOPSA_CLIENT_ID: 'x' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HaloConfigError);
      const configErr = err as HaloConfigError;
      expect(configErr.missing).toEqual(['HALOPSA_BASE_URL', 'HALOPSA_CLIENT_SECRET']);
      expect(configErr.message).toContain('HALOPSA_BASE_URL');
    }
    expect(isHaloConfigured({})).toBe(false);
    expect(isHaloConfigured(env)).toBe(true);
  });

  it('rejects a non-URL base', () => {
    expect(() => loadHaloConfig({ ...env, HALOPSA_BASE_URL: 'portal' })).toThrow(HaloConfigError);
  });
});

describe('createTokenProvider', () => {
  it('posts a client_credentials form to the tenant token URL', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return tokenResponse('abc');
    };
    const provider = createTokenProvider({ config: TEST_CONFIG, fetchImpl });

    expect(await provider.getToken()).toBe('abc');
    expect(calls[0].url).toBe('https://halo.test/auth/token?tenant=masri');
    expect(calls[0].init?.method).toBe('POST');
    const form = new URLSearchParams(String(calls[0].init?.body));
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('client_id')).toBe('cid');
    expect(form.get('client_secret')).toBe('secret');
    expect(form.get('scope')).toBe('read:tickets');
  });

  it('omits the tenant query when not configured', () => {
    expect(buildTokenUrl({ ...TEST_CONFIG, tenant: undefined })).toBe(
      'https://halo.test/auth/token',
    );
  });

  it('caches until 60s before expiry, then refreshes', async () => {
    let clock = 1_000_000;
    let count = 0;
    const fetchImpl: FetchLike = async () => tokenResponse(`t${++count}`, 120);
    const provider = createTokenProvider({ config: TEST_CONFIG, fetchImpl, now: () => clock });

    expect(await provider.getToken()).toBe('t1');
    clock += 59_000;
    expect(await provider.getToken()).toBe('t1');
    clock += 2_000; // 61s elapsed: inside the 60s refresh skew of a 120s token
    expect(await provider.getToken()).toBe('t2');
    expect(count).toBe(2);
  });

  it('single-flights concurrent refreshes', async () => {
    let count = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl: FetchLike = async () => {
      count++;
      await gate;
      return tokenResponse('shared');
    };
    const provider = createTokenProvider({ config: TEST_CONFIG, fetchImpl });
    const pending = Promise.all([provider.getToken(), provider.getToken(), provider.getToken()]);
    release();
    expect(await pending).toEqual(['shared', 'shared', 'shared']);
    expect(count).toBe(1);
  });

  it('invalidate forces a new token', async () => {
    let count = 0;
    const fetchImpl: FetchLike = async () => tokenResponse(`t${++count}`);
    const provider = createTokenProvider({ config: TEST_CONFIG, fetchImpl });
    await provider.getToken();
    provider.invalidate();
    expect(await provider.getToken()).toBe('t2');
  });

  it('throws HaloAuthError with status on failure', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ error: 'invalid_client' }, { status: 401 });
    const provider = createTokenProvider({ config: TEST_CONFIG, fetchImpl });
    const err = await provider.getToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HaloAuthError);
    expect((err as HaloAuthError).status).toBe(401);
  });

  it('retries after a failed refresh (no stuck in-flight promise)', async () => {
    let count = 0;
    const fetchImpl: FetchLike = async () =>
      ++count === 1 ? jsonResponse({}, { status: 500 }) : tokenResponse('ok');
    const provider = createTokenProvider({ config: TEST_CONFIG, fetchImpl });
    await provider.getToken().catch(() => undefined);
    expect(await provider.getToken()).toBe('ok');
  });
});
