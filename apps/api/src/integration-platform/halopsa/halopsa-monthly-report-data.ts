import { db } from '@db';
import { ClientPostureQueryService } from '../../client-posture/client-posture-query.service';
import type { ClientPostureSummary } from '../../client-posture/client-posture.types';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LIST_ITEMS = 40;

export interface ReportListItem {
  title: string;
  detail?: string;
}

export interface MonthlyReportData {
  organizationId: string;
  organizationName: string;
  monthLabel: string;
  generatedAt: Date;
  latest: ClientPostureSummary | null;
  /** Daily overall score for the last 30 days, oldest first. */
  trend: Array<{ date: string; overallScore: number }>;
  failingChecks: ReportListItem[];
  overdueTasks: ReportListItem[];
  openFindings: ReportListItem[];
  expiringEvidence: ReportListItem[];
}

/** "September 2026" for the month before `now` (the month being reported). */
export function reportMonth(now: Date): { label: string; key: string } {
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const label = month.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const key = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`;
  return { label, key };
}

/** Last snapshot per UTC day. */
export function dailyTrend(history: ClientPostureSummary[]): MonthlyReportData['trend'] {
  const byDay = new Map<string, number>();
  for (const snapshot of history) {
    byDay.set(snapshot.capturedAt.toISOString().slice(0, 10), snapshot.overallScore);
  }
  return [...byDay.entries()].map(([date, overallScore]) => ({ date, overallScore }));
}

function day(date: Date | null): string | undefined {
  return date ? date.toISOString().slice(0, 10) : undefined;
}

export async function collectMonthlyReportData({
  organizationId,
  now,
  postureQuery = new ClientPostureQueryService(),
}: {
  organizationId: string;
  now: Date;
  postureQuery?: ClientPostureQueryService;
}): Promise<MonthlyReportData> {
  const horizon = new Date(now.getTime() + 30 * DAY_MS);
  const activeTask = { organizationId, archivedAt: null };

  const [org, history, failed, overdue, findings, expiring] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    postureQuery.getHistory({ organizationId, days: 30, now }),
    db.task.findMany({
      where: { ...activeTask, status: 'failed' },
      select: { title: true, integrationLastRunAt: true },
      orderBy: { title: 'asc' },
      take: MAX_LIST_ITEMS,
    }),
    db.task.findMany({
      where: { ...activeTask, reviewDate: { lt: now }, status: { notIn: ['done', 'not_relevant'] } },
      select: { title: true, reviewDate: true },
      orderBy: { reviewDate: 'asc' },
      take: MAX_LIST_ITEMS,
    }),
    db.finding.findMany({
      where: { organizationId, status: { not: 'closed' } },
      select: { content: true, severity: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_LIST_ITEMS,
    }),
    db.task.findMany({
      where: { ...activeTask, reviewDate: { gte: now, lte: horizon }, status: { not: 'not_relevant' } },
      select: { title: true, reviewDate: true },
      orderBy: { reviewDate: 'asc' },
      take: MAX_LIST_ITEMS,
    }),
  ]);

  return {
    organizationId,
    organizationName: org?.name ?? organizationId,
    monthLabel: reportMonth(now).label,
    generatedAt: now,
    latest: history.length ? history[history.length - 1] : null,
    trend: dailyTrend(history),
    failingChecks: failed.map((t) => ({ title: t.title, detail: day(t.integrationLastRunAt) })),
    overdueTasks: overdue.map((t) => ({ title: t.title, detail: day(t.reviewDate) })),
    openFindings: findings.map((f) => ({
      title: (f.content.split('\n')[0] ?? '').slice(0, 160) || 'Finding',
      detail: f.severity,
    })),
    expiringEvidence: expiring.map((t) => ({ title: t.title, detail: day(t.reviewDate) })),
  };
}
