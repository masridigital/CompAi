import { db, type Impact, type Likelihood } from '@db';
import { buildDeepLink, escapeHtml, safeSummaryText, safeText, type TicketContent } from './halopsa-ticket-content';

const DAY_MS = 24 * 60 * 60 * 1000;
export const EVIDENCE_EXPIRY_WINDOW_DAYS = 30;
export const POLICY_REVIEW_WINDOW_DAYS = 7;
/** Residual likelihood x impact (1-5 each) at or above this is "above threshold". */
export const RISK_SCORE_THRESHOLD = 12;
const MAX_ITEMS_PER_SECTION = 25;

const LIKELIHOOD_SCORE: Record<Likelihood, number> = {
  very_unlikely: 1,
  unlikely: 2,
  possible: 3,
  likely: 4,
  very_likely: 5,
};
const IMPACT_SCORE: Record<Impact, number> = {
  insignificant: 1,
  minor: 2,
  moderate: 3,
  major: 4,
  severe: 5,
};

export function riskScore({ likelihood, impact }: { likelihood: Likelihood; impact: Impact }): number {
  return LIKELIHOOD_SCORE[likelihood] * IMPACT_SCORE[impact];
}

interface DigestItem {
  id: string;
  title: string;
  date?: Date | null;
}

export interface DigestItems {
  overdueTasks: DigestItem[];
  expiringEvidence: DigestItem[];
  policiesDue: DigestItem[];
  vendorsDue: DigestItem[];
  risksAboveThreshold: DigestItem[];
}

export function digestItemCount(items: DigestItems): number {
  return Object.values(items).reduce((sum, list: DigestItem[]) => sum + list.length, 0);
}

export async function collectDigestItems({
  organizationId,
  now,
}: {
  organizationId: string;
  now: Date;
}): Promise<DigestItems> {
  const evidenceHorizon = new Date(now.getTime() + EVIDENCE_EXPIRY_WINDOW_DAYS * DAY_MS);
  const policyHorizon = new Date(now.getTime() + POLICY_REVIEW_WINDOW_DAYS * DAY_MS);
  const activeTask = { organizationId, archivedAt: null, status: { not: 'not_relevant' as const } };

  const [overdue, expiring, policies, vendors, risks] = await Promise.all([
    db.task.findMany({
      where: { ...activeTask, reviewDate: { lt: now } },
      select: { id: true, title: true, reviewDate: true },
      orderBy: { reviewDate: 'asc' },
    }),
    db.task.findMany({
      where: { ...activeTask, status: 'done', reviewDate: { gte: now, lte: evidenceHorizon } },
      select: { id: true, title: true, reviewDate: true },
      orderBy: { reviewDate: 'asc' },
    }),
    db.policy.findMany({
      where: { organizationId, isArchived: false, archivedAt: null, reviewDate: { lte: policyHorizon } },
      select: { id: true, name: true, reviewDate: true },
      orderBy: { reviewDate: 'asc' },
    }),
    db.vendor.findMany({
      where: { organizationId, status: 'not_assessed' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    db.risk.findMany({
      where: { organizationId, status: { in: ['open', 'pending'] } },
      select: { id: true, title: true, residualLikelihood: true, residualImpact: true },
    }),
  ]);

  return {
    overdueTasks: overdue.map((t) => ({ id: t.id, title: t.title, date: t.reviewDate })),
    expiringEvidence: expiring.map((t) => ({ id: t.id, title: t.title, date: t.reviewDate })),
    policiesDue: policies.map((p) => ({ id: p.id, title: p.name, date: p.reviewDate })),
    vendorsDue: vendors.map((v) => ({ id: v.id, title: v.name })),
    risksAboveThreshold: risks
      .filter(
        (r) => riskScore({ likelihood: r.residualLikelihood, impact: r.residualImpact }) >= RISK_SCORE_THRESHOLD,
      )
      .map((r) => ({ id: r.id, title: r.title })),
  };
}

function section({
  title,
  items,
  organizationId,
  path,
}: {
  title: string;
  items: DigestItem[];
  organizationId: string;
  path: string;
}): string {
  if (items.length === 0) return '';
  const listed = items.slice(0, MAX_ITEMS_PER_SECTION);
  const rows = listed
    .map((item) => {
      const date = item.date ? ` (${escapeHtml(item.date.toISOString().slice(0, 10))})` : '';
      return `<li>${safeText(item.title)}${date}</li>`;
    })
    .join('');
  const more = items.length > listed.length ? `<p>…and ${items.length - listed.length} more.</p>` : '';
  const url = buildDeepLink({ organizationId, path: [path] });
  return `<h3>${escapeHtml(title)} (${items.length})</h3><ul>${rows}</ul>${more}<p><a href="${escapeHtml(url)}">Open in CompAI</a></p>`;
}

export function buildDigestTicket({
  refToken,
  organizationId,
  organizationName,
  items,
  weekLabel,
}: {
  refToken: string;
  organizationId: string;
  organizationName: string;
  items: DigestItems;
  weekLabel: string;
}): TicketContent {
  const total = digestItemCount(items);
  const summary = `[CompAI] Weekly compliance digest ${weekLabel}: ${total} item${total === 1 ? '' : 's'} due [${refToken}]`;
  const details = [
    `<p>Weekly compliance digest for <strong>${safeText(organizationName)}</strong> (${escapeHtml(weekLabel)}).</p>`,
    section({ title: 'Overdue tasks', items: items.overdueTasks, organizationId, path: 'tasks' }),
    section({ title: 'Evidence expiring in 30 days', items: items.expiringEvidence, organizationId, path: 'tasks' }),
    section({ title: 'Policies due for review', items: items.policiesDue, organizationId, path: 'policies' }),
    section({ title: 'Vendors due for review', items: items.vendorsDue, organizationId, path: 'vendors' }),
    section({ title: 'Risks above threshold', items: items.risksAboveThreshold, organizationId, path: 'risk' }),
    `<p>Reference: ${escapeHtml(refToken)} · ${escapeHtml(safeSummaryText(organizationName, 80))}</p>`,
  ].join('');
  return { summary, details };
}

/** ISO week label, e.g. "2026-W39" (UTC). */
export function isoWeekLabel(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
