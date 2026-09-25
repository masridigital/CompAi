import { Logger } from '@nestjs/common';
import type { FindingSeverity } from '@trycompai/integration-platform';
import { HaloAlertService, type CheckResultInput } from './halopsa-alert.service';
import { resolveNonCompliantSince } from './halopsa-device-tracker';

/**
 * Hook entry points called from core flows (plan 6.4). Every function here
 * swallows and logs its own errors: HaloPSA problems must never break the
 * host flow (check runs, findings, device check-ins).
 */

const logger = new Logger('HaloHooks');
let service: HaloAlertService | null = null;

function alerts(): HaloAlertService {
  service ??= new HaloAlertService();
  return service;
}

/** Tests only. */
export function setHaloAlertServiceForTests(next: HaloAlertService | null): void {
  service = next;
}

async function safely(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    logger.warn(`HaloPSA ${label} hook failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function haloOnCheckResults(results: CheckResultInput[]): Promise<void> {
  for (const result of results) {
    await safely(`check ${result.checkId}`, () => alerts().onCheckResult(result));
  }
}

type FindingStatusLike = 'open' | 'ready_for_review' | 'needs_revision' | 'closed';

export interface FindingHookInput {
  organizationId: string;
  finding: {
    id: string;
    content: string;
    severity: FindingSeverity;
    task?: { title: string } | null;
  };
}

function findingTitle(finding: FindingHookInput['finding']): string {
  const firstLine = finding.content.split('\n')[0]?.trim() ?? '';
  const base = firstLine || 'Finding';
  return finding.task?.title ? `${finding.task.title}: ${base}` : base;
}

export async function haloOnFindingCreated({ organizationId, finding }: FindingHookInput): Promise<void> {
  await safely(`finding ${finding.id} created`, () =>
    alerts().onFindingCreated({
      organizationId,
      findingId: finding.id,
      title: findingTitle(finding),
      severity: finding.severity,
      description: finding.content,
    }),
  );
}

/** Closed -> resolve the ticket; reopened from closed -> regression handling. */
export async function haloOnFindingStatusChanged({
  organizationId,
  finding,
  previousStatus,
  newStatus,
}: FindingHookInput & { previousStatus: FindingStatusLike; newStatus: FindingStatusLike }): Promise<void> {
  if (newStatus === 'closed') {
    await safely(`finding ${finding.id} closed`, () =>
      alerts().onFindingClosed({ organizationId, findingId: finding.id, title: findingTitle(finding) }),
    );
    return;
  }
  if (previousStatus === 'closed') await haloOnFindingCreated({ organizationId, finding });
}

export async function haloOnDeviceCompliance(input: {
  organizationId: string;
  deviceId: string;
  deviceName: string;
  compliant: boolean;
  failingChecks?: string[];
}): Promise<void> {
  await safely(`device ${input.deviceId}`, async () => {
    const nonCompliantSince = await resolveNonCompliantSince({
      deviceId: input.deviceId,
      compliant: input.compliant,
    });
    await alerts().onDeviceCompliance({ ...input, nonCompliantSince });
  });
}
