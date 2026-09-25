import { Injectable, Logger } from '@nestjs/common';
import { db } from '@db';
import { meetsMinSeverity } from '@trycompai/integration-platform';
import type { FindingSeverity } from '@trycompai/integration-platform';
import { applyAlertSignal, type AlertSignal } from './halopsa-alert-engine';
import { loadHaloOrgConnection } from './halopsa-connection';
import { triggerDrainSoon } from './halopsa-drain-trigger';
import {
  buildCheckTicket,
  buildDeviceTicket,
  buildFindingTicket,
  type FailingResource,
} from './halopsa-ticket-content';
import { HALO_DEVICE_NONCOMPLIANT_GRACE_MS } from './halopsa.constants';

export type AlertResult =
  | 'no_connection'
  | 'trigger_disabled'
  | 'below_min_severity'
  | 'grace_period'
  | AlertSignalDecision;
type AlertSignalDecision = 'none' | 'create' | 'note' | 'reopen' | 'resolve' | 'cancel';

export interface CheckResultInput {
  organizationId: string;
  checkId: string;
  checkName: string;
  passed: boolean;
  severity: FindingSeverity | null;
  failingResources: FailingResource[];
  remediation?: string | null;
  taskId: string;
}

export interface FindingInput {
  organizationId: string;
  findingId: string;
  title: string;
  severity: FindingSeverity;
  description?: string | null;
}

export interface DeviceComplianceInput {
  organizationId: string;
  deviceId: string;
  deviceName: string;
  compliant: boolean;
  nonCompliantSince: Date | null;
  failingChecks?: string[];
}

type SignalSpec = Omit<AlertSignal, 'connectionId' | 'settings' | 'priorityId' | 'now'> & {
  severity: FindingSeverity;
  priorityFor: (map: Record<'critical' | 'high' | 'medium' | 'low', number>) => number;
};

/**
 * Turns CompAI events into HaloPSA ticket intents (plan 5.2 / 6.4). Stateless
 * and DI-free (uses the shared Prisma client) so Trigger.dev tasks can use it
 * with `new HaloAlertService()`.
 */
@Injectable()
export class HaloAlertService {
  private readonly logger = new Logger(HaloAlertService.name);

  protected now(): Date {
    return new Date();
  }

  async onCheckResult(input: CheckResultInput): Promise<AlertResult> {
    const count = input.failingResources.length;
    const severity = input.severity ?? 'medium';
    return this.handle({
      organizationId: input.organizationId,
      trigger: 'integration_check_failed',
      entityType: 'check',
      entityId: input.taskId,
      dedupKey: `integration_check_failed:${input.checkId}`,
      failing: !input.passed,
      severity,
      priorityFor: (map) => (severity === 'high' || severity === 'critical' ? map.high : map.medium),
      buildTicket: async (refToken) => {
        const ctx = await this.orgContext(input.organizationId);
        return buildCheckTicket({ ...ctx, ...input, refToken });
      },
      repeatNote: `Check "${input.checkName}" is still failing (${count} resource${count === 1 ? '' : 's'}) as of ${this.now().toISOString()}.`,
      resolveNote: `Check "${input.checkName}" is passing again in CompAI as of ${this.now().toISOString()}.`,
      reopenNote: `Check "${input.checkName}" failed again after being resolved (${count} resource${count === 1 ? '' : 's'}). Reopening.`,
    });
  }

  async onFindingCreated(input: FindingInput): Promise<AlertResult> {
    return this.handle({
      organizationId: input.organizationId,
      trigger: 'finding_created',
      entityType: 'finding',
      entityId: input.findingId,
      dedupKey: `finding:${input.findingId}`,
      failing: true,
      severity: input.severity,
      priorityFor: (map) => map[input.severity === 'info' ? 'low' : input.severity],
      buildTicket: async (refToken) => {
        const ctx = await this.orgContext(input.organizationId);
        return buildFindingTicket({ ...ctx, ...input, refToken });
      },
      repeatNote: `Finding "${input.title}" is still open in CompAI.`,
      resolveNote: `Finding "${input.title}" was closed in CompAI.`,
      reopenNote: `Finding "${input.title}" was reopened in CompAI.`,
    });
  }

  async onFindingClosed(input: Pick<FindingInput, 'organizationId' | 'findingId' | 'title'> & {
    severity?: FindingSeverity;
  }): Promise<AlertResult> {
    return this.handle({
      organizationId: input.organizationId,
      trigger: 'finding_created',
      entityType: 'finding',
      entityId: input.findingId,
      dedupKey: `finding:${input.findingId}`,
      failing: false,
      severity: input.severity ?? 'low',
      priorityFor: (map) => map.low,
      buildTicket: async () => ({ summary: '', details: '' }),
      repeatNote: '',
      resolveNote: `Finding "${input.title}" was closed in CompAI.`,
      reopenNote: '',
    });
  }

  async onDeviceCompliance(input: DeviceComplianceInput): Promise<AlertResult> {
    const since = input.nonCompliantSince;
    if (
      !input.compliant &&
      (!since || this.now().getTime() - since.getTime() < HALO_DEVICE_NONCOMPLIANT_GRACE_MS)
    ) {
      return 'grace_period';
    }
    return this.handle({
      organizationId: input.organizationId,
      trigger: 'device_noncompliant',
      entityType: 'device',
      entityId: input.deviceId,
      dedupKey: `device:${input.deviceId}`,
      failing: !input.compliant,
      severity: 'medium',
      priorityFor: (map) => map.medium,
      buildTicket: async (refToken) => {
        const ctx = await this.orgContext(input.organizationId);
        return buildDeviceTicket({
          ...ctx,
          refToken,
          deviceName: input.deviceName,
          nonCompliantSince: since ?? this.now(),
          failingChecks: input.failingChecks ?? [],
        });
      },
      repeatNote: `Device "${input.deviceName}" is still noncompliant.`,
      resolveNote: `Device "${input.deviceName}" is compliant again in CompAI.`,
      reopenNote: `Device "${input.deviceName}" is noncompliant again. Reopening.`,
    });
  }

  private async handle(spec: SignalSpec): Promise<AlertResult> {
    const halo = await loadHaloOrgConnection(spec.organizationId);
    if (!halo) return 'no_connection';
    const { settings, connection } = halo;

    // Opening tickets is opt-in per trigger and severity; resolving an already
    // open ticket always goes through so Halo never keeps stale alerts.
    if (spec.failing) {
      if (!settings.enabledTriggers.includes(spec.trigger)) {
        return 'trigger_disabled';
      }
      if (!meetsMinSeverity({ severity: spec.severity, minSeverity: settings.minSeverity })) {
        return 'below_min_severity';
      }
    }

    const outcome = await applyAlertSignal({
      ...spec,
      connectionId: connection.id,
      settings,
      priorityId: spec.priorityFor(settings.priorityMap),
      now: this.now(),
    });

    if (outcome.enqueued.length > 0) {
      this.logger.log(
        `Halo ${outcome.decision} for ${spec.dedupKey} (org ${spec.organizationId}): ${outcome.enqueued.join(', ')}`,
      );
      await triggerDrainSoon(this.now());
    }
    return outcome.decision;
  }

  private async orgContext(organizationId: string) {
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: {
        name: true,
        frameworkInstances: {
          select: { framework: { select: { name: true } }, customFramework: { select: { name: true } } },
        },
      },
    });
    const frameworks = (org?.frameworkInstances ?? [])
      .map((fi) => fi.framework?.name ?? fi.customFramework?.name)
      .filter((name): name is string => Boolean(name));
    return { organizationId, organizationName: org?.name ?? organizationId, frameworks };
  }
}
