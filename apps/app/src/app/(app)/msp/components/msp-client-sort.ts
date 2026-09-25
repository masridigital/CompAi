import type { MspClient } from '@/hooks/use-msp-overview';

export type MspClientSortKey =
  | 'name'
  | 'score'
  | 'failingChecks'
  | 'overdueTasks'
  | 'openFindings'
  | 'evidenceExpiring30d'
  | 'openHaloTickets'
  | 'lastActivityAt';

export type SortDirection = 'asc' | 'desc';

export interface MspClientSort {
  key: MspClientSortKey;
  direction: SortDirection;
}

/** First click on a numeric column sorts worst-first (desc); name sorts A→Z. */
export function defaultDirection(key: MspClientSortKey): SortDirection {
  if (key === 'name') return 'asc';
  if (key === 'score') return 'asc';
  return 'desc';
}

export function nextSort({
  current,
  key,
}: {
  current: MspClientSort;
  key: MspClientSortKey;
}): MspClientSort {
  if (current.key !== key) return { key, direction: defaultDirection(key) };
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

function sortValue({ client, key }: { client: MspClient; key: MspClientSortKey }): number | null {
  const p = client.posture;
  switch (key) {
    case 'score':
      return p?.overallScore ?? null;
    case 'failingChecks':
      return p?.failingChecks ?? null;
    case 'overdueTasks':
      return p?.overdueTasks ?? null;
    case 'openFindings':
      return p?.openFindings ?? null;
    case 'evidenceExpiring30d':
      return p?.evidenceExpiring30d ?? null;
    case 'openHaloTickets':
      return client.openHaloTickets;
    case 'lastActivityAt':
      return client.lastActivityAt ? Date.parse(client.lastActivityAt) : null;
    default:
      return null;
  }
}

/** Sort clients; rows without a value (no data / not permitted) always go last. */
export function sortClients({
  clients,
  sort,
}: {
  clients: MspClient[];
  sort: MspClientSort;
}): MspClient[] {
  const factor = sort.direction === 'asc' ? 1 : -1;
  return [...clients].sort((a, b) => {
    if (sort.key === 'name') return factor * a.name.localeCompare(b.name);
    const av = sortValue({ client: a, key: sort.key });
    const bv = sortValue({ client: b, key: sort.key });
    if (av === null && bv === null) return a.name.localeCompare(b.name);
    if (av === null) return 1;
    if (bv === null) return -1;
    return factor * (av - bv) || a.name.localeCompare(b.name);
  });
}

/** Case-insensitive match on client name, org id and Halo client name. */
export function filterClients({
  clients,
  query,
}: {
  clients: MspClient[];
  query: string;
}): MspClient[] {
  const q = query.trim().toLowerCase();
  if (!q) return clients;
  return clients.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.organizationId.toLowerCase().includes(q) ||
      (c.haloClient?.name ?? '').toLowerCase().includes(q),
  );
}
