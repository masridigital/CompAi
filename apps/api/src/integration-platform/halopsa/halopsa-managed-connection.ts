import { ForbiddenException } from '@nestjs/common';
import { halopsaManifest, hasReservedHaloBindingKey } from '@trycompai/integration-platform';
import { HALOPSA_PROVIDER_SLUG } from './halopsa.constants';

/**
 * Guards for the generic customer connection endpoints. A `halopsa`
 * connection is bound to a Halo client by the platform admin only: every Halo
 * call uses the instance-wide HALOPSA_* app, so letting an org pick its own
 * Halo client id would expose other clients' Halo data.
 */
export const HALO_MANAGED_MESSAGE =
  'HaloPSA connections are managed by your MSP. Ask your MSP administrator to connect this organization or change its Halo client.';

/** Variables declared by the manifest (alert_*, evidence check and sync settings). */
function editableVariableIds(): Set<string> {
  return new Set((halopsaManifest.variables ?? []).map((v) => v.id));
}

function isHalo(providerSlug: string | null | undefined): boolean {
  return providerSlug === HALOPSA_PROVIDER_SLUG;
}

/** POST /v1/integrations/connections */
export function assertCustomerMayCreateConnection(providerSlug: string): void {
  if (isHalo(providerSlug)) throw new ForbiddenException(HALO_MANAGED_MESSAGE);
}

/** PUT /v1/integrations/connections/:id/credentials */
export function assertCustomerMayUpdateCredentials(providerSlug: string | null | undefined): void {
  if (isHalo(providerSlug)) throw new ForbiddenException(HALO_MANAGED_MESSAGE);
}

/** PATCH /v1/integrations/connections/:id (metadata holds the binding and webhook token hash). */
export function assertCustomerMayUpdateMetadata({
  providerSlug,
  metadata,
}: {
  providerSlug: string | null | undefined;
  metadata: Record<string, unknown> | undefined;
}): void {
  if (!isHalo(providerSlug)) return;
  if (metadata && Object.keys(metadata).length > 0) {
    throw new ForbiddenException(HALO_MANAGED_MESSAGE);
  }
}

/**
 * POST /v1/integrations/variables/connections/:id. Org admins may tune the
 * declared alert and check settings; binding keys (and anything undeclared)
 * are refused.
 */
export function assertCustomerMayUpdateVariables({
  providerSlug,
  variables,
}: {
  providerSlug: string | null | undefined;
  variables: Record<string, unknown> | undefined;
}): void {
  if (!isHalo(providerSlug) || !variables) return;
  if (hasReservedHaloBindingKey(variables)) {
    throw new ForbiddenException(HALO_MANAGED_MESSAGE);
  }
  const editable = editableVariableIds();
  const unknown = Object.keys(variables).filter((key) => !editable.has(key));
  if (unknown.length > 0) {
    throw new ForbiddenException(
      `These HaloPSA settings cannot be changed here: ${unknown.join(', ')}. ${HALO_MANAGED_MESSAGE}`,
    );
  }
}
