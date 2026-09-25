import { z } from 'zod';

/**
 * HaloPSA instance-wide configuration.
 *
 * The Halo API application (client ID + secret) is shared by every client org,
 * so it is read from the environment of the API / worker process, never from a
 * per-connection credential.
 */

export const DEFAULT_HALOPSA_SCOPE =
  'read:customers read:tickets edit:tickets read:assets read:teams read:agents';

/** Treat empty / whitespace-only env values as unset. */
const optionalEnv = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional(),
);

const HaloEnvSchema = z.object({
  HALOPSA_BASE_URL: optionalEnv,
  HALOPSA_AUTH_URL: optionalEnv,
  HALOPSA_TENANT: optionalEnv,
  HALOPSA_CLIENT_ID: optionalEnv,
  HALOPSA_CLIENT_SECRET: optionalEnv,
  HALOPSA_SCOPE: optionalEnv,
});

export interface HaloConfig {
  /** Halo web root, e.g. https://portal.masri.tech (no trailing slash, no /api). */
  baseUrl: string;
  /** Authorisation server root; the token endpoint is `${authUrl}/token`. */
  authUrl: string;
  /** Hosted tenant name, appended as `?tenant=` to the token call when set. */
  tenant?: string;
  clientId: string;
  clientSecret: string;
  /** Space-separated scope list. */
  scope: string;
}

export type HaloEnv = Record<string, string | undefined>;

const REQUIRED_VARS = ['HALOPSA_BASE_URL', 'HALOPSA_CLIENT_ID', 'HALOPSA_CLIENT_SECRET'] as const;

export class HaloConfigError extends Error {
  readonly missing: string[];

  constructor({ message, missing }: { message: string; missing: string[] }) {
    super(message);
    this.name = 'HaloConfigError';
    this.missing = missing;
  }
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function assertUrl({ name, value }: { name: string; value: string }): string {
  const parsed = z.string().url().safeParse(value);
  if (!parsed.success) {
    throw new HaloConfigError({
      message: `HaloPSA is misconfigured: ${name} must be an absolute URL (got "${value}").`,
      missing: [],
    });
  }
  return stripTrailingSlash(value);
}

/**
 * Parse the HALOPSA_* environment into a {@link HaloConfig}.
 * Throws {@link HaloConfigError} naming every missing variable.
 */
export function loadHaloConfig(env: HaloEnv = process.env): HaloConfig {
  const parsed = HaloEnvSchema.parse({
    HALOPSA_BASE_URL: env.HALOPSA_BASE_URL,
    HALOPSA_AUTH_URL: env.HALOPSA_AUTH_URL,
    HALOPSA_TENANT: env.HALOPSA_TENANT,
    HALOPSA_CLIENT_ID: env.HALOPSA_CLIENT_ID,
    HALOPSA_CLIENT_SECRET: env.HALOPSA_CLIENT_SECRET,
    HALOPSA_SCOPE: env.HALOPSA_SCOPE,
  });

  const missing = REQUIRED_VARS.filter((name) => !parsed[name]);
  if (missing.length > 0) {
    throw new HaloConfigError({
      message: `HaloPSA is not configured on this server: missing ${missing.join(', ')}. Set them in the API and worker environment.`,
      missing: [...missing],
    });
  }

  const baseUrl = assertUrl({ name: 'HALOPSA_BASE_URL', value: parsed.HALOPSA_BASE_URL ?? '' });
  const authUrl = parsed.HALOPSA_AUTH_URL
    ? assertUrl({ name: 'HALOPSA_AUTH_URL', value: parsed.HALOPSA_AUTH_URL })
    : `${baseUrl}/auth`;

  return {
    baseUrl,
    authUrl,
    tenant: parsed.HALOPSA_TENANT,
    clientId: parsed.HALOPSA_CLIENT_ID ?? '',
    clientSecret: parsed.HALOPSA_CLIENT_SECRET ?? '',
    scope: parsed.HALOPSA_SCOPE ?? DEFAULT_HALOPSA_SCOPE,
  };
}

/** True when the required HALOPSA_* variables are present and valid. */
export function isHaloConfigured(env: HaloEnv = process.env): boolean {
  try {
    loadHaloConfig(env);
    return true;
  } catch {
    return false;
  }
}
