import type { MspOverview } from '@/hooks/use-msp-overview';
import { serverApi } from '@/lib/api-server';
import { isMspStaffRole } from '@/lib/msp-access';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MspMasterPane } from './components/MspMasterPane';

export const metadata: Metadata = {
  title: 'All clients | Comp AI',
};

interface AuthMeResponse {
  user: { role: string | null } | null;
}

/**
 * MSP master pane. Lives outside /[orgId] (like /account/two-factor): it is
 * not tied to one tenant. Only platform admins and msp_staff may open it;
 * the API enforces the same rule and scopes every row.
 */
export default async function MspPage() {
  const meRes = await serverApi.get<AuthMeResponse>('/v1/auth/me');
  if (!isMspStaffRole(meRes.data?.user?.role)) {
    redirect('/');
  }

  const overviewRes = await serverApi.get<MspOverview>('/v1/msp/overview');
  if (overviewRes.status === 401 || overviewRes.status === 403) {
    redirect('/');
  }

  return <MspMasterPane initialOverview={overviewRes.data ?? null} />;
}
