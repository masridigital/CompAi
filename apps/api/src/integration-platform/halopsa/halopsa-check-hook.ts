import { Logger } from '@nestjs/common';
import type { FindingSeverity } from '@trycompai/integration-platform';
import type { CheckResultInput } from './halopsa-alert.service';
import { haloOnCheckResults } from './halopsa-hooks';

const logger = new Logger('HaloCheckHook');

const SEVERITY_ORDER: FindingSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];

export interface HaloCheckRunSummary {
  checkId: string;
  checkName: string;
  findings: Array<{
    resourceId: string;
    resourceType?: string | null;
    title: string;
    severity?: FindingSeverity | null;
    remediation?: string | null;
  }>;
}

interface ExceptionLookup {
  has: (connectionId: string, checkId: string, resourceId: string) => boolean;
}

function maxSeverity(severities: Array<FindingSeverity | null | undefined>): FindingSeverity | null {
  let best = -1;
  for (const severity of severities) {
    if (!severity) continue;
    best = Math.max(best, SEVERITY_ORDER.indexOf(severity));
  }
  return best >= 0 ? SEVERITY_ORDER[best] : null;
}

/** Per-check alert inputs for one task run, excluding findings under an active exception. */
export function buildHaloCheckResults({
  organizationId,
  taskId,
  connectionId,
  checks,
  exceptions,
}: {
  organizationId: string;
  taskId: string;
  connectionId: string;
  checks: HaloCheckRunSummary[];
  exceptions: ExceptionLookup;
}): CheckResultInput[] {
  return checks.map((check) => {
    const failing = check.findings.filter(
      (f) => !exceptions.has(connectionId, check.checkId, f.resourceId),
    );
    return {
      organizationId,
      taskId,
      checkId: check.checkId,
      checkName: check.checkName,
      passed: failing.length === 0,
      severity: maxSeverity(failing.map((f) => f.severity)),
      failingResources: failing.map((f) => ({
        title: f.title,
        resourceId: f.resourceId,
        resourceType: f.resourceType,
      })),
      remediation: failing.find((f) => f.remediation)?.remediation ?? null,
    };
  });
}

/**
 * Hook for run-task-integration-checks, called after the task status
 * transition. Never throws.
 */
export async function haloOnTaskCheckRun(params: Parameters<typeof buildHaloCheckResults>[0]): Promise<void> {
  try {
    if (params.checks.length === 0) return;
    await haloOnCheckResults(buildHaloCheckResults(params));
  } catch (error) {
    logger.warn(`HaloPSA check hook failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
