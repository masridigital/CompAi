import type {
  ClientPostureSummary,
  FrameworkScore,
} from '../client-posture/client-posture.types';
import type { HaloClientRef } from '../integration-platform/halopsa/halopsa-admin-client-lookup';
import {
  canReadInOrg,
  type MspOrg,
  type MspResource,
  type MspScope,
} from './msp-scope';

/**
 * Latest posture snapshot with each field nulled out when the viewer's role
 * in that org lacks the read permission for the underlying data.
 */
export interface MspPosture {
  capturedAt: Date;
  overallScore: number | null;
  frameworkScores: FrameworkScore[] | null;
  controlsPassing: number | null;
  controlsTotal: number | null;
  failingChecks: number | null;
  integrationErrors: number | null;
  overdueTasks: number | null;
  evidenceExpiring30d: number | null;
  openFindings: number | null;
  policiesUnpublished: number | null;
  lastActivityAt: Date | null;
}

export interface MspClientRow {
  organizationId: string;
  name: string;
  logo: string | null;
  posture: MspPosture | null;
  haloClient: HaloClientRef | null;
  /** Null when the viewer may not read integrations in this org. */
  openHaloTickets: number | null;
  lastActivityAt: Date | null;
}

export interface MspTotals {
  clients: number;
  avgScore: number | null;
  failingChecks: number;
  overdueTasks: number;
  openFindings: number;
  evidenceExpiring30d: number;
  openHaloTickets: number;
}

function gate<T>(allowed: boolean, value: T): T | null {
  return allowed ? value : null;
}

export function maskPosture({
  posture,
  can,
}: {
  posture: ClientPostureSummary;
  can: (resource: MspResource) => boolean;
}): MspPosture {
  const framework = can('framework');
  const integration = can('integration');
  const task = can('task');
  return {
    capturedAt: posture.capturedAt,
    overallScore: gate(framework, posture.overallScore),
    frameworkScores: gate(framework, posture.frameworkScores),
    controlsPassing: gate(framework, posture.controlsPassing),
    controlsTotal: gate(framework, posture.controlsTotal),
    failingChecks: gate(integration, posture.failingChecks),
    integrationErrors: gate(integration, posture.integrationErrors),
    overdueTasks: gate(task, posture.overdueTasks),
    evidenceExpiring30d: gate(can('evidence'), posture.evidenceExpiring30d),
    openFindings: gate(can('finding'), posture.openFindings),
    policiesUnpublished: gate(can('policy'), posture.policiesUnpublished),
    lastActivityAt: gate(can('app'), posture.lastActivityAt),
  };
}

export function buildClientRow({
  org,
  scope,
  posture,
  haloClient,
  openHaloTickets,
}: {
  org: MspOrg;
  scope: MspScope;
  posture: ClientPostureSummary | undefined;
  haloClient: HaloClientRef | undefined;
  openHaloTickets: number | undefined;
}): MspClientRow {
  const can = (resource: MspResource) =>
    canReadInOrg({ scope, organizationId: org.id, resource });
  const masked = posture ? maskPosture({ posture, can }) : null;
  const integration = can('integration');
  return {
    organizationId: org.id,
    name: org.name,
    logo: org.logo,
    posture: masked,
    haloClient: integration ? (haloClient ?? null) : null,
    openHaloTickets: integration ? (openHaloTickets ?? 0) : null,
    lastActivityAt: masked?.lastActivityAt ?? null,
  };
}

function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

/** KPI totals over the visible (unmasked) values only. */
export function computeTotals(clients: MspClientRow[]): MspTotals {
  const scores = clients
    .map((c) => c.posture?.overallScore)
    .filter((s): s is number => typeof s === 'number');
  return {
    clients: clients.length,
    avgScore: scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null,
    failingChecks: sum(clients.map((c) => c.posture?.failingChecks)),
    overdueTasks: sum(clients.map((c) => c.posture?.overdueTasks)),
    openFindings: sum(clients.map((c) => c.posture?.openFindings)),
    evidenceExpiring30d: sum(
      clients.map((c) => c.posture?.evidenceExpiring30d),
    ),
    openHaloTickets: sum(clients.map((c) => c.openHaloTickets)),
  };
}
