'use client';

import { api } from '@/lib/api-client';
import {
  Button,
  DataTableFilters,
  DataTableHeader,
  DataTableSearch,
  Stack,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@trycompai/design-system';
import { Renew } from '@trycompai/design-system/icons';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import type { AdminOrg, AdminOrgsResponse } from './admin-org-types';
import { parseOrgSort, sortOrgs, type OrgSort } from './org-posture-sort';
import { OrgRow } from './OrgRow';
import { COLUMN_VISIBILITY_CLASSES } from './PostureCells';
import { PostureSortSelect } from './PostureSortSelect';

const PAGE_SIZE = 25;

async function fetchOrgs(search: string, page: number): Promise<AdminOrgsResponse> {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    page: String(page),
  });
  if (search) params.set('search', search);
  const res = await api.get<AdminOrgsResponse>(`/v1/admin/organizations?${params}`);
  if (res.error) throw new Error(res.error);
  return res.data ?? { data: [], total: 0, page: 1, limit: PAGE_SIZE };
}

export function OrganizationsTable({
  initialOrgs,
  initialTotal,
  initialPage,
  initialSearch,
  orgId,
}: {
  initialOrgs: AdminOrg[];
  initialTotal: number;
  initialPage: number;
  initialSearch: string;
  orgId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const page = Math.max(1, parseInt(searchParams.get('page') ?? String(initialPage), 10));
  const search = searchParams.get('search') ?? initialSearch;
  const sort = parseOrgSort(searchParams.get('sort'));

  const [inputValue, setInputValue] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const { data, mutate, isLoading } = useSWR<AdminOrgsResponse>(
    ['admin-orgs', search, page],
    () => fetchOrgs(search, page),
    {
      fallbackData: {
        data: initialOrgs,
        total: initialTotal,
        page: initialPage,
        limit: PAGE_SIZE,
      },
      revalidateOnMount: search !== initialSearch || page !== initialPage || !initialOrgs.length,
    },
  );

  const orgs = useMemo(
    () => sortOrgs({ orgs: Array.isArray(data?.data) ? data.data : [], sort }),
    [data, sort],
  );
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`);
    },
    [router, pathname, searchParams],
  );

  const handleSearchChange = (value: string) => {
    setInputValue(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParams({ search: value || null, page: null });
    }, 300);
  };

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  const handlePageChange = (newPage: number) => {
    updateParams({ page: newPage > 1 ? String(newPage) : null });
  };

  const handleSortChange = (next: OrgSort) => {
    updateParams({ sort: next === 'name' ? null : next });
  };

  return (
    <Stack gap="md">
      <DataTableHeader>
        <DataTableSearch
          placeholder="Search by name, ID, owner..."
          value={inputValue}
          onChange={handleSearchChange}
        />
        <DataTableFilters>
          <PostureSortSelect value={sort} onChange={handleSortChange} />
          <Button
            variant="outline"
            onClick={() => mutate()}
            loading={isLoading}
            iconLeft={<Renew size={16} />}
          >
            Refresh
          </Button>
          <Text size="sm" variant="muted">
            {total} organizations
          </Text>
        </DataTableFilters>
      </DataTableHeader>

      {orgs.length === 0 ? (
        <div className="flex h-32 items-center justify-center">
          <Text variant="muted">No organizations found.</Text>
        </div>
      ) : (
        <div className={COLUMN_VISIBILITY_CLASSES} data-testid="organizations-table">
          <Table
            variant="bordered"
            pagination={{
              page,
              pageCount: totalPages,
              onPageChange: handlePageChange,
            }}
          >
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead data-col="lg">Owner</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Failing checks</TableHead>
                <TableHead data-col="md">Overdue tasks</TableHead>
                <TableHead data-col="md">Open findings</TableHead>
                <TableHead data-col="lg">Expiring (30d)</TableHead>
                <TableHead data-col="xl">Members</TableHead>
                <TableHead data-col="xl">Created</TableHead>
                <TableHead data-col="md">Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.map((org) => (
                <OrgRow key={org.id} org={org} orgId={orgId} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Stack>
  );
}
