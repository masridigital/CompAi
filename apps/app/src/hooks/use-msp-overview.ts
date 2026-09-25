'use client';

import { api } from '@/lib/api-client';
import useSWR from 'swr';

export interface MspFrameworkScore {
  frameworkId: string;
  name: string;
  score: number;
}

/** Latest posture snapshot; fields are null when the viewer may not read them. */
export interface MspPosture {
  capturedAt: string;
  overallScore: number | null;
  frameworkScores: MspFrameworkScore[] | null;
  controlsPassing: number | null;
  controlsTotal: number | null;
  failingChecks: number | null;
  integrationErrors: number | null;
  overdueTasks: number | null;
  evidenceExpiring30d: number | null;
  openFindings: number | null;
  policiesUnpublished: number | null;
  lastActivityAt: string | null;
}

export interface MspHaloClient {
  id: number;
  name: string | null;
  url: string | null;
}

export interface MspClient {
  organizationId: string;
  name: string;
  logo: string | null;
  posture: MspPosture | null;
  haloClient: MspHaloClient | null;
  openHaloTickets: number | null;
  lastActivityAt: string | null;
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

export interface MspOverview {
  totals: MspTotals;
  clients: MspClient[];
}

export const mspOverviewKey = '/v1/msp/overview';

export async function fetchMsp<T>(url: string): Promise<T> {
  const response = await api.get<T>(url);
  if (response.error) throw new Error(response.error);
  if (response.data === undefined || response.data === null) {
    throw new Error('Empty response');
  }
  return response.data;
}

export function useMspOverview({ fallbackData }: { fallbackData?: MspOverview | null }) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<MspOverview>(
    mspOverviewKey,
    () => fetchMsp<MspOverview>(mspOverviewKey),
    {
      fallbackData: fallbackData ?? undefined,
      revalidateOnMount: !fallbackData,
      revalidateOnFocus: false,
    },
  );
  return {
    totals: data?.totals ?? null,
    clients: Array.isArray(data?.clients) ? data.clients : [],
    error: error instanceof Error ? error : null,
    isLoading: isLoading && !data,
    isValidating,
    mutate,
  };
}
