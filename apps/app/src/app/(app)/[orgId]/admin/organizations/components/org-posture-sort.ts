import { z } from 'zod';
import type { AdminOrg, ClientPosture } from './admin-org-types';

export const orgSortSchema = z.enum([
  'name',
  'score',
  'failingChecks',
  'overdueTasks',
  'openFindings',
  'evidenceExpiring30d',
]);
export type OrgSort = z.infer<typeof orgSortSchema>;

export const ORG_SORT_OPTIONS: { value: OrgSort; label: string }[] = [
  { value: 'name', label: 'Name (A-Z)' },
  { value: 'score', label: 'Lowest score' },
  { value: 'failingChecks', label: 'Most failing checks' },
  { value: 'overdueTasks', label: 'Most overdue tasks' },
  { value: 'openFindings', label: 'Most open findings' },
  { value: 'evidenceExpiring30d', label: 'Most evidence expiring' },
];

export function parseOrgSort(value: string | null | undefined): OrgSort {
  const parsed = orgSortSchema.safeParse(value);
  return parsed.success ? parsed.data : 'name';
}

type MetricKey = Exclude<OrgSort, 'name' | 'score'>;

function metricOf({ posture, key }: { posture: ClientPosture; key: MetricKey }): number {
  return posture[key];
}

/**
 * Sort orgs by name or a posture metric. Score sorts ascending (worst first);
 * count metrics sort descending (most problems first). Orgs without a posture
 * snapshot always sort last. Ties fall back to name.
 */
export function sortOrgs({ orgs, sort }: { orgs: AdminOrg[]; sort: OrgSort }): AdminOrg[] {
  const byName = (a: AdminOrg, b: AdminOrg) => a.name.localeCompare(b.name);
  if (sort === 'name') return [...orgs].sort(byName);

  return [...orgs].sort((a, b) => {
    const pa = a.posture ?? null;
    const pb = b.posture ?? null;
    if (!pa && !pb) return byName(a, b);
    if (!pa) return 1;
    if (!pb) return -1;

    const diff =
      sort === 'score'
        ? pa.overallScore - pb.overallScore
        : metricOf({ posture: pb, key: sort }) - metricOf({ posture: pa, key: sort });
    return diff !== 0 ? diff : byName(a, b);
  });
}
