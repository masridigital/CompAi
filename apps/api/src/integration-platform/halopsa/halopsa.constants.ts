/** HaloPSA alerting constants (plan sections 5.2 and 6.4). */

export const HALOPSA_PROVIDER_SLUG = 'halopsa';

/** Regression within this window after resolve reopens the same ticket. */
export const HALO_REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** A device must be noncompliant this long before a ticket is raised. */
export const HALO_DEVICE_NONCOMPLIANT_GRACE_MS = 24 * 60 * 60 * 1000;

/** Outbox retry delays, indexed by attempt number (1-based, capped at the last). */
export const HALO_OUTBOX_BACKOFF_MS = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
] as const;

/** After this many failed attempts an event goes `dead`. */
export const HALO_OUTBOX_MAX_ATTEMPTS = 8;

/** Events claimed per drain run. */
export const HALO_OUTBOX_BATCH_SIZE = 25;

/** A `processing` event older than this is treated as abandoned and re-claimed. */
export const HALO_OUTBOX_STALE_PROCESSING_MS = 15 * 60_000;

/** Failing resources listed in a ticket before collapsing into a count. */
export const HALO_MAX_LISTED_RESOURCES = 50;

/** Webhook bodies are remembered this long for replay protection. */
export const HALO_WEBHOOK_REPLAY_TTL_SECONDS = 24 * 60 * 60;

/** Connection metadata key holding sha256(connectionToken). */
export const HALO_WEBHOOK_TOKEN_HASH_KEY = 'halopsaWebhookTokenHash';

export const HALO_DRAIN_TASK_ID = 'drain-halopsa-outbox';

export type HaloOutboxKind =
  | 'create_ticket'
  | 'add_note'
  | 'set_status'
  | 'reopen'
  | 'push_custom_fields';

export type HaloEntityType = 'check' | 'finding' | 'device' | 'digest';

export function isOutboxPaused(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HALOPSA_OUTBOX_PAUSED === 'true';
}

export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.NEXT_PUBLIC_APP_URL || env.APP_URL || 'http://localhost:3000';
  return url.replace(/\/+$/, '');
}

export function apiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.BASE_URL || 'http://localhost:3333';
  return url.replace(/\/+$/, '');
}
