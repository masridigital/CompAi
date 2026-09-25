import { db } from '@db';

const DAY_MS = 24 * 60 * 60 * 1000;
export const EVIDENCE_EXPIRY_WINDOW_DAYS = 30;

/** Task statuses that count as finished work. */
const FINISHED_TASK_STATUSES = ['done', 'not_relevant'] as const;

export interface PostureCounts {
  overdueTasks: number;
  openFindings: number;
  evidenceExpiring30d: number;
  policiesUnpublished: number;
  integrationErrors: number;
  lastActivityAt: Date | null;
}

/**
 * Simple per-org counters that feed the posture snapshot. Each one is a single
 * COUNT query scoped by organizationId.
 *
 * - overdueTasks: active tasks whose reviewDate has passed and that are not
 *   done / not relevant (Task has no due date; reviewDate is the deadline).
 * - evidenceExpiring30d: active, non-"not relevant" tasks whose reviewDate
 *   falls within the next 30 days (their evidence needs refreshing).
 * - openFindings: findings not yet closed.
 * - policiesUnpublished: draft or needs_review, not archived — same definition
 *   as `unpublishedPolicies` in frameworks-scores.helper.ts (overview dashboard).
 * - integrationErrors: IntegrationConnection rows in `error` status.
 * - lastActivityAt: latest audit log entry.
 */
export async function loadPostureCounts({
  organizationId,
  now,
}: {
  organizationId: string;
  now: Date;
}): Promise<PostureCounts> {
  const expiryCutoff = new Date(
    now.getTime() + EVIDENCE_EXPIRY_WINDOW_DAYS * DAY_MS,
  );

  const [
    overdueTasks,
    evidenceExpiring30d,
    openFindings,
    policiesUnpublished,
    integrationErrors,
    lastAudit,
  ] = await Promise.all([
    db.task.count({
      where: {
        organizationId,
        archivedAt: null,
        reviewDate: { lt: now },
        status: { notIn: [...FINISHED_TASK_STATUSES] },
      },
    }),
    db.task.count({
      where: {
        organizationId,
        archivedAt: null,
        reviewDate: { gte: now, lte: expiryCutoff },
        status: { not: 'not_relevant' },
      },
    }),
    db.finding.count({
      where: { organizationId, status: { not: 'closed' } },
    }),
    db.policy.count({
      where: {
        organizationId,
        isArchived: false,
        archivedAt: null,
        status: { in: ['draft', 'needs_review'] },
      },
    }),
    db.integrationConnection.count({
      where: { organizationId, status: 'error' },
    }),
    db.auditLog.findFirst({
      where: { organizationId },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    }),
  ]);

  return {
    overdueTasks,
    evidenceExpiring30d,
    openFindings,
    policiesUnpublished,
    integrationErrors,
    lastActivityAt: lastAudit?.timestamp ?? null,
  };
}

/** Tasks + evidence needed to evaluate per-control status. */
export async function loadControlInputs(organizationId: string): Promise<{
  tasks: { status: string; controlIds: string[] }[];
  evidenceSubmissions: { formType: string; submittedAt: Date }[];
}> {
  const [tasks, evidenceSubmissions] = await Promise.all([
    db.task.findMany({
      where: {
        organizationId,
        archivedAt: null,
        frameworkControlLinks: {
          some: { frameworkInstance: { organizationId } },
        },
      },
      select: {
        status: true,
        frameworkControlLinks: {
          where: { frameworkInstance: { organizationId } },
          select: { controlId: true },
        },
      },
    }),
    db.evidenceSubmission.findMany({
      where: { organizationId },
      select: { formType: true, submittedAt: true },
    }),
  ]);

  return {
    tasks: tasks.map((t) => ({
      status: t.status,
      controlIds: t.frameworkControlLinks.map((l) => l.controlId),
    })),
    evidenceSubmissions,
  };
}
