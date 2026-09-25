import type { CheckContext } from '../../../types';
import {
  createHaloClient,
  HaloApiError,
  HaloAuthError,
  HaloConfigError,
  ticketClosedAt,
  ticketOpenedAt,
  type HaloAction,
  type HaloClient,
  type HaloTicket,
} from '../client';
import { haloMappingFromMetadata, HALO_NOT_BOUND_MESSAGE, type HaloConnectionMapping } from '../binding';
import { parseHaloCheckSettings, type HaloCheckSettings } from '../settings';

export const EVIDENCE_WINDOW_DAYS = 90;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface HaloCheckRun {
  halo: HaloClient;
  mapping: HaloConnectionMapping;
  settings: HaloCheckSettings;
  now: Date;
  windowStart: Date;
  resourceId: string;
}

export function clientResourceId(clientId: number | string): string {
  return `halo-client-${clientId}`;
}

/**
 * Resolve config, mapping and settings, then run `body`. Any setup or API
 * failure is reported as a single finding with remediation, never thrown.
 */
export async function runHaloCheck({
  ctx,
  body,
}: {
  ctx: CheckContext;
  body: (run: HaloCheckRun) => Promise<void>;
}): Promise<void> {
  // The binding is admin-written connection metadata; credentials and
  // variables are customer-editable and never used to pick the Halo client.
  const mapping = haloMappingFromMetadata(ctx.metadata);
  if (!mapping) {
    ctx.fail({
      title: 'HaloPSA connection is not bound to a Halo client',
      description: HALO_NOT_BOUND_MESSAGE,
      resourceType: 'halopsa-connection',
      resourceId: ctx.connectionId,
      severity: 'medium',
      remediation: 'Ask your MSP administrator to bind this organization to its HaloPSA client.',
    });
    return;
  }

  const resourceId = clientResourceId(mapping.haloClientId);
  let halo: HaloClient;
  try {
    halo = createHaloClient();
  } catch (err) {
    // Env names and config details stay in server logs only.
    console.warn('[halopsa] check setup failed', {
      connectionId: ctx.connectionId,
      error: err instanceof Error ? err.message : String(err),
      missing: err instanceof HaloConfigError ? err.missing : undefined,
    });
    ctx.fail({
      title: 'HaloPSA is not configured on this server',
      description: 'The HaloPSA integration is not configured on this server.',
      resourceType: 'halopsa-client',
      resourceId,
      severity: 'medium',
      remediation: 'Contact your MSP administrator to finish the HaloPSA server setup, then re-run the check.',
    });
    return;
  }

  const now = new Date();
  try {
    await body({
      halo,
      mapping,
      settings: parseHaloCheckSettings(ctx.variables),
      now,
      windowStart: new Date(now.getTime() - EVIDENCE_WINDOW_DAYS * DAY_MS),
      resourceId,
    });
  } catch (err) {
    reportHaloError({ ctx, err, resourceId });
  }
}

function reportHaloError({
  ctx,
  err,
  resourceId,
}: {
  ctx: CheckContext;
  err: unknown;
  resourceId: string;
}) {
  const status =
    err instanceof HaloApiError || err instanceof HaloAuthError ? err.status : undefined;
  const denied = status === 401 || status === 403;
  // Halo response bodies can echo configuration: log them server-side only.
  console.warn('[halopsa] check request failed', {
    connectionId: ctx.connectionId,
    status,
    error: err instanceof Error ? err.message : String(err),
  });
  ctx.error('HaloPSA check failed', { status });
  ctx.fail({
    title: denied ? 'HaloPSA denied access' : 'Could not read HaloPSA',
    description: `HaloPSA request failed (status ${status ?? 'unknown'})`,
    resourceType: 'halopsa-client',
    resourceId,
    severity: 'medium',
    remediation: denied
      ? 'Ask your MSP administrator to check the Halo API application credentials and scopes (read:customers read:tickets edit:tickets read:assets read:teams read:agents).'
      : 'Confirm HaloPSA is reachable and re-run the check.',
  });
}

export function hoursBetween({ from, to }: { from: Date; to: Date }): number {
  return (to.getTime() - from.getTime()) / HOUR_MS;
}

/** Tickets of the given types for the mapped client logged inside the evidence window. */
export async function ticketsInWindow({
  run,
  ticketTypeIds,
}: {
  run: HaloCheckRun;
  ticketTypeIds: number[];
}): Promise<HaloTicket[]> {
  const tickets = await run.halo.searchTickets({
    clientId: run.mapping.haloClientId,
    ticketTypeIds,
    since: run.windowStart,
  });
  return tickets.filter((ticket) => {
    const openedAt = ticketOpenedAt(ticket);
    return openedAt !== null && openedAt >= run.windowStart;
  });
}

export function ticketEvidence(ticket: HaloTicket): Record<string, unknown> {
  return {
    ticketId: ticket.id,
    summary: ticket.summary ?? '',
    ticketTypeId: ticket.tickettype_id ?? null,
    statusId: ticket.status_id ?? null,
    openedAt: ticketOpenedAt(ticket)?.toISOString() ?? null,
    closedAt: ticketClosedAt(ticket)?.toISOString() ?? null,
  };
}

const RESOLUTION_OUTCOME = /resol|clos|complet|fix/i;
const APPROVED_OUTCOME = /approv/i;
const NOT_APPROVED = /reject|declin|deny|denied|pending|request|await/i;

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.replace(/<[^>]*>/g, '').trim().length > 0;
}

export function hasResolutionNote({
  ticket,
  actions,
}: {
  ticket: HaloTicket;
  actions: HaloAction[];
}): boolean {
  if (hasText(ticket.closure_note) || hasText(ticket.resolution)) return true;
  return actions.some(
    (action) => RESOLUTION_OUTCOME.test(action.outcome ?? '') && hasText(action.note),
  );
}

export function hasApproval({
  ticket,
  actions,
}: {
  ticket: HaloTicket;
  actions: HaloAction[];
}): boolean {
  if (ticket.isapproved === true || ticket.approved === true) return true;
  return actions.some((action) => {
    const outcome = action.outcome ?? '';
    return APPROVED_OUTCOME.test(outcome) && !NOT_APPROVED.test(outcome);
  });
}

export function missingTicketTypesFinding({
  ctx,
  resourceId,
  variableLabel,
}: {
  ctx: CheckContext;
  resourceId: string;
  variableLabel: string;
}): void {
  ctx.fail({
    title: `${variableLabel} are not configured`,
    description: `Set "${variableLabel}" on the HaloPSA connection so CompAI knows which Halo tickets to read.`,
    resourceType: 'halopsa-client',
    resourceId,
    severity: 'low',
    remediation: `Open the HaloPSA connection settings and enter the Halo ticket type IDs under "${variableLabel}".`,
  });
}
