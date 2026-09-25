'use client';

import { api } from '@/lib/api-client';
import useSWR from 'swr';

export interface HaloMappingSuggestion {
  organizationId: string;
  organizationName: string;
  reason: 'domain' | 'name';
}

export interface HaloClientRow {
  id: number;
  name: string;
  website: string | null;
  mapping: { organizationId: string; organizationName: string; connectionId: string } | null;
  suggestions: HaloMappingSuggestion[];
}

export interface HaloConnectionRow {
  connectionId: string;
  organizationId: string;
  organizationName: string;
  status: string;
  haloClientId: number | null;
  haloSiteId: number | null;
  hasWebhookToken: boolean;
}

export interface HaloOrgOption {
  id: string;
  name: string;
  website: string | null;
}

export interface HaloClientsResponse {
  clients: HaloClientRow[];
  unmappedOrganizations: HaloOrgOption[];
  connections: HaloConnectionRow[];
}

export interface HaloOutboxRow {
  id: string;
  organizationId: string;
  organization?: { id: string; name: string } | null;
  linkId: string;
  kind: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  nextAttemptAt: string;
}

export const haloClientsKey = ['/v1/admin/halopsa/clients'] as const;
export const haloConnectionsKey = ['/v1/admin/halopsa/connections'] as const;
export const haloDeadOutboxKey = ['/v1/admin/halopsa/outbox?status=dead'] as const;

async function fetchOrThrow<T>(url: string): Promise<T> {
  const response = await api.get<T>(url);
  if (response.error) throw new Error(response.error);
  if (response.data === undefined || response.data === null) throw new Error('Empty response');
  return response.data;
}

export function useHaloClients() {
  const { data, error, isLoading, mutate } = useSWR(
    haloClientsKey,
    () => fetchOrThrow<HaloClientsResponse>(haloClientsKey[0]),
    { revalidateOnFocus: false },
  );
  return {
    clients: Array.isArray(data?.clients) ? data.clients : [],
    unmappedOrganizations: Array.isArray(data?.unmappedOrganizations) ? data.unmappedOrganizations : [],
    error: error instanceof Error ? error : null,
    isLoading: isLoading && !data,
    mutate,
  };
}

export function useHaloConnections() {
  const { data, error, isLoading, mutate } = useSWR(
    haloConnectionsKey,
    () => fetchOrThrow<{ data: HaloConnectionRow[] }>(haloConnectionsKey[0]),
    { revalidateOnFocus: false },
  );
  return {
    connections: Array.isArray(data?.data) ? data.data : [],
    error: error instanceof Error ? error : null,
    isLoading: isLoading && !data,
    mutate,
  };
}

export function useHaloDeadOutbox() {
  const { data, error, isLoading, mutate } = useSWR(
    haloDeadOutboxKey,
    () => fetchOrThrow<{ data: HaloOutboxRow[] }>(haloDeadOutboxKey[0]),
    { revalidateOnFocus: false },
  );
  return {
    events: Array.isArray(data?.data) ? data.data : [],
    error: error instanceof Error ? error : null,
    isLoading: isLoading && !data,
    mutate,
  };
}

export async function bindHaloClient({
  haloClientId,
  organizationId,
  haloSiteId,
}: {
  haloClientId: number;
  organizationId: string;
  haloSiteId?: number;
}) {
  return api.post(`/v1/admin/halopsa/clients/${haloClientId}/bind`, {
    organizationId,
    ...(haloSiteId ? { haloSiteId } : {}),
  });
}

export async function createOrgFromHaloClient({
  haloClientId,
  ownerEmail,
}: {
  haloClientId: number;
  /** Invited as owner; the acting platform admin joins as admin. */
  ownerEmail?: string;
}) {
  return api.post<{ organizationId: string; ownerInvitationId: string | null }>(
    `/v1/admin/halopsa/clients/${haloClientId}/create-org`,
    ownerEmail ? { ownerEmail } : {},
  );
}

export async function issueHaloWebhookToken({ connectionId }: { connectionId: string }) {
  return api.post<{ token: string; url: string }>(
    `/v1/admin/halopsa/connections/${connectionId}/webhook-token`,
    {},
  );
}

export async function retryHaloOutboxEvent({ id }: { id: string }) {
  return api.post(`/v1/admin/halopsa/outbox/${id}/retry`, {});
}
