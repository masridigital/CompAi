import { z } from 'zod';
import type { CustomAuthConfig } from '../../types';

/**
 * Per-org HaloPSA connection fields. The Halo API secret itself is
 * instance-wide (HALOPSA_* env), so a connection only says which Halo client
 * (and optionally site) this org maps to.
 */
export const halopsaCredentialFields: NonNullable<CustomAuthConfig['credentialFields']> = [
  {
    id: 'haloClientId',
    label: 'Halo client ID',
    type: 'text',
    required: true,
    placeholder: '42',
    helpText:
      'Numeric ID of this customer in HaloPSA (Customers > open the client > ID in the URL).',
  },
  {
    id: 'haloSiteId',
    label: 'Halo site ID',
    type: 'text',
    required: false,
    placeholder: '57',
    helpText: 'Optional. Site to raise tickets against; defaults to the client’s main site.',
  },
];

const numericString = z
  .string()
  .trim()
  .regex(/^\d+$/, 'must be a numeric Halo ID')
  .transform((value) => Number(value))
  .refine((value) => value > 0, 'must be a positive Halo ID');

export const halopsaCredentialSchema = z.object({
  haloClientId: numericString,
  haloSiteId: z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    numericString.optional(),
  ),
});

export interface HaloConnectionMapping {
  haloClientId: number;
  haloSiteId?: number;
}

function scalar(value: unknown): unknown {
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'number') return String(value);
  return value;
}

/**
 * Resolve the Halo client/site mapping from connection credentials, falling
 * back to connection variables (plan 5.4 stores them there).
 * Returns an error message instead of throwing so callers can report it.
 */
export function resolveHaloConnectionMapping({
  credentials,
  variables,
}: {
  credentials?: Record<string, unknown>;
  variables?: Record<string, unknown>;
}): { success: true; data: HaloConnectionMapping } | { success: false; error: string } {
  const source = {
    haloClientId: scalar(credentials?.haloClientId ?? variables?.haloClientId),
    haloSiteId: scalar(credentials?.haloSiteId ?? variables?.haloSiteId),
  };
  const parsed = halopsaCredentialSchema.safeParse(source);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join('.') || 'haloClientId';
    return {
      success: false,
      error: `Invalid HaloPSA connection: ${field} ${issue?.message ?? 'is required'}`,
    };
  }
  return { success: true, data: parsed.data };
}

export const halopsaSetupInstructions = `HaloPSA uses one Halo API application for every client. The server administrator sets it once in the API and worker environment:

- HALOPSA_BASE_URL (e.g. https://portal.masri.tech)
- HALOPSA_AUTH_URL (optional, defaults to HALOPSA_BASE_URL/auth)
- HALOPSA_TENANT (optional, hosted tenant name)
- HALOPSA_CLIENT_ID and HALOPSA_CLIENT_SECRET
- HALOPSA_SCOPE (optional)

For this organization, enter the matching Halo client ID (and optionally site ID). "Test connection" looks the client up in Halo.`;
