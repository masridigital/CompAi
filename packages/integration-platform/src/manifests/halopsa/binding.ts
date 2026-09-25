import { z } from 'zod';

/**
 * The Halo client binding of a `halopsa` connection.
 *
 * Every Halo call uses the instance-wide HALOPSA_* API application, so the
 * binding decides whose Halo data an org can read and write. It is written
 * ONLY by the platform-admin bind flow (POST /v1/admin/halopsa/clients/:id/bind)
 * into connection metadata under HALO_BINDING_METADATA_KEY. Credentials and
 * variables are never consulted: customers can write those.
 */
export const HALO_BINDING_METADATA_KEY = 'halopsaBinding';

/** Keys customers must never set on a halopsa connection (variables, credentials, metadata). */
export const HALO_BINDING_RESERVED_KEYS: readonly string[] = [
  HALO_BINDING_METADATA_KEY,
  'haloClientId',
  'haloSiteId',
  'haloClientName',
];

const positiveId = z.number().int().positive();

export const HaloBindingSchema = z.object({
  haloClientId: positiveId,
  haloSiteId: positiveId.optional(),
  haloClientName: z.string().max(500).optional(),
  boundAt: z.string().optional(),
  boundByUserId: z.string().optional(),
});
export type HaloBinding = z.infer<typeof HaloBindingSchema>;

export interface HaloConnectionMapping {
  haloClientId: number;
  haloSiteId?: number;
}

export const HALO_NOT_BOUND_MESSAGE =
  'This HaloPSA connection is not bound to a Halo client yet. Your MSP administrator binds it from the admin HaloPSA page.';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Read the admin-written binding from connection metadata. */
export function resolveHaloBinding(
  metadata: unknown,
): { success: true; data: HaloBinding } | { success: false; error: string } {
  const parsed = HaloBindingSchema.safeParse(asRecord(metadata)[HALO_BINDING_METADATA_KEY]);
  if (!parsed.success) return { success: false, error: HALO_NOT_BOUND_MESSAGE };
  return { success: true, data: parsed.data };
}

/** The client/site mapping used for Halo calls, or null when unbound. */
export function haloMappingFromMetadata(metadata: unknown): HaloConnectionMapping | null {
  const binding = resolveHaloBinding(metadata);
  if (!binding.success) return null;
  const { haloClientId, haloSiteId } = binding.data;
  return haloSiteId ? { haloClientId, haloSiteId } : { haloClientId };
}

/** True when a record carries any key reserved for the admin binding. */
export function hasReservedHaloBindingKey(record: Record<string, unknown> | undefined): boolean {
  if (!record) return false;
  return Object.keys(record).some((key) => HALO_BINDING_RESERVED_KEYS.includes(key));
}
