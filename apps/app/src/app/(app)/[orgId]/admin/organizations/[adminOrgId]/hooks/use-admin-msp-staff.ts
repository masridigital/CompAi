'use client';

import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';

export interface MspStaffMember {
  id: string;
  role: string;
  createdAt: string;
  user: { id: string; name: string; email: string; role: string | null };
}

export interface MspStaffCandidate {
  id: string;
  name: string;
  email: string;
  role: string | null;
}

interface ListResponse<T> {
  data: T[];
  count: number;
}

export const adminMspStaffKey = (orgId: string) =>
  ['/v1/admin/organizations', orgId, 'msp-staff'] as const;

/** Active MSP staff (global role msp_staff/admin) in one organization. */
export function useAdminMspStaff(orgId: string) {
  const { data, error, isLoading, mutate } = useSWR(
    adminMspStaffKey(orgId),
    async () => {
      const res = await apiClient.get<ListResponse<MspStaffMember>>(
        `/v1/admin/organizations/${orgId}/msp-staff`,
      );
      if (res.error) throw new Error(res.error);
      return res.data?.data ?? [];
    },
    { revalidateOnFocus: false },
  );

  return {
    staff: Array.isArray(data) ? data : [],
    isLoading: isLoading && !data,
    error,
    mutate,
  };
}

/** Users assignable as MSP staff, filtered by name/email. */
export function useMspStaffCandidates({ search, enabled }: { search: string; enabled: boolean }) {
  const term = search.trim();
  const { data, error, isLoading } = useSWR(
    enabled ? ['/v1/admin/users/msp-staff', term] : null,
    async () => {
      const query = term ? `?search=${encodeURIComponent(term)}` : '';
      const res = await apiClient.get<ListResponse<MspStaffCandidate>>(
        `/v1/admin/users/msp-staff${query}`,
      );
      if (res.error) throw new Error(res.error);
      return res.data?.data ?? [];
    },
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  return {
    candidates: Array.isArray(data) ? data : [],
    isLoading: isLoading && !data,
    error,
  };
}

export async function addMspStaff({
  orgId,
  userIds,
  orgRole,
}: {
  orgId: string;
  userIds: string[];
  orgRole?: string;
}): Promise<void> {
  const res = await apiClient.post(`/v1/admin/organizations/${orgId}/msp-staff`, {
    userIds,
    ...(orgRole ? { orgRole } : {}),
  });
  if (res.error) throw new Error(res.error);
}

export async function removeMspStaff({
  orgId,
  userId,
}: {
  orgId: string;
  userId: string;
}): Promise<void> {
  const res = await apiClient.delete(`/v1/admin/organizations/${orgId}/msp-staff/${userId}`);
  if (res.error) throw new Error(res.error);
}
