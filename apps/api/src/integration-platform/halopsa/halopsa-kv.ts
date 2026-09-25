import { Redis } from '@upstash/redis';

/**
 * Minimal KV used by the HaloPSA integration (webhook replay protection and
 * device noncompliance markers). Uses the same Upstash env as the rest of the
 * API; `null` when Upstash is not configured. `@trycompai/kv` is not used
 * because it imports `server-only`, which throws outside React Server runtimes.
 */
export type HaloKv = Pick<Redis, 'get' | 'set' | 'del'>;

let cached: HaloKv | null | undefined;

export function getHaloKv(env: NodeJS.ProcessEnv = process.env): HaloKv | null {
  if (cached !== undefined) return cached;
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  cached = url && token ? new Redis({ url, token }) : null;
  return cached;
}

/** Tests only. */
export function setHaloKvForTests(kv: HaloKv | null | undefined): void {
  cached = kv;
}
