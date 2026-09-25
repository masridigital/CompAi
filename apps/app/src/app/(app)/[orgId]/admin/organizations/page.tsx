import { serverApi } from '@/lib/api-server';
import { PageHeader, PageLayout } from '@trycompai/design-system';
import type { AdminOrgsResponse } from './components/admin-org-types';
import { OrganizationsTable } from './components/OrganizationsTable';

const PAGE_SIZE = 25;

export default async function AdminOrganizationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgId } = await params;
  const sp = await searchParams;

  const search = typeof sp.search === 'string' ? sp.search : '';
  const page = Math.max(1, parseInt(String(sp.page ?? '1'), 10));

  const qs = new URLSearchParams({
    limit: String(PAGE_SIZE),
    page: String(page),
  });
  if (search) qs.set('search', search);

  const res = await serverApi.get<AdminOrgsResponse>(`/v1/admin/organizations?${qs}`);

  return (
    <PageLayout header={<PageHeader title="Organizations" />}>
      <OrganizationsTable
        initialOrgs={res.data?.data ?? []}
        initialTotal={res.data?.total ?? 0}
        initialPage={page}
        initialSearch={search}
        orgId={orgId}
      />
    </PageLayout>
  );
}
