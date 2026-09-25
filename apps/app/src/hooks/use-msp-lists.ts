'use client';

import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { fetchMsp } from './use-msp-overview';

const PAGE_SIZE = 50;

export interface MspTaskRow {
  organizationId: string;
  orgName: string;
  taskId: string;
  title: string;
  status: string;
  assigneeName: string | null;
  reviewDate: string | null;
}

export interface MspFindingRow {
  organizationId: string;
  orgName: string;
  findingId: string;
  title: string;
  severity: string;
  status: string;
  createdAt: string;
}

export interface MspFailingCheckRow {
  organizationId: string;
  orgName: string;
  connectionId: string;
  provider: string;
  checkId: string;
  checkName: string;
  failingResources: number;
  lastRunAt: string | null;
  taskId: string | null;
}

export interface MspHaloTicketRow {
  organizationId: string;
  orgName: string;
  linkId: string;
  entityType: string;
  entityId: string;
  haloTicketId: number | null;
  refToken: string;
  state: string;
  url: string | null;
  createdAt: string;
  lastEventAt: string;
}

interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

/** Cursor-paginated list endpoint (`{ data, nextCursor }`) with "load more". */
function useCursorList<T>({
  path,
  params,
}: {
  path: string;
  params: Record<string, string | undefined>;
}) {
  const getKey = (index: number, previous: CursorPage<T> | null): string | null => {
    if (previous && !previous.nextCursor) return null;
    const search = new URLSearchParams({ limit: String(PAGE_SIZE) });
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    if (index > 0 && previous?.nextCursor) search.set('cursor', previous.nextCursor);
    return `${path}?${search.toString()}`;
  };

  const { data, error, isLoading, size, setSize, mutate } = useSWRInfinite<CursorPage<T>>(
    getKey,
    (url: string) => fetchMsp<CursorPage<T>>(url),
    { revalidateOnFocus: false },
  );

  const pages = Array.isArray(data) ? data : [];
  const rows = pages.flatMap((page) => (Array.isArray(page?.data) ? page.data : []));
  const last = pages[pages.length - 1];
  return {
    rows,
    hasMore: Boolean(last?.nextCursor),
    loadMore: () => setSize(size + 1),
    error: error instanceof Error ? error : null,
    isLoading: isLoading && pages.length === 0,
    mutate,
  };
}

export function useMspTasks({ view }: { view: 'overdue' | 'due-soon' }) {
  return useCursorList<MspTaskRow>({ path: '/v1/msp/tasks', params: { view } });
}

export function useMspFindings({ severity }: { severity?: string } = {}) {
  return useCursorList<MspFindingRow>({
    path: '/v1/msp/findings',
    params: { status: 'open', severity },
  });
}

export function useMspHaloTickets() {
  return useCursorList<MspHaloTicketRow>({
    path: '/v1/msp/halo-tickets',
    params: { state: 'open' },
  });
}

export function useMspFailingChecks() {
  const { data, error, isLoading, mutate } = useSWR<{ data: MspFailingCheckRow[] }>(
    '/v1/msp/checks/failing',
    (url: string) => fetchMsp<{ data: MspFailingCheckRow[] }>(url),
    { revalidateOnFocus: false },
  );
  return {
    rows: Array.isArray(data?.data) ? data.data : [],
    error: error instanceof Error ? error : null,
    isLoading: isLoading && !data,
    mutate,
  };
}
