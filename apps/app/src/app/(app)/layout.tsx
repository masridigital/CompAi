import { serverApi } from '@/lib/api-server';
import { TWO_FACTOR_SETUP_PATH } from '@/lib/two-factor';
import { auth } from '@/utils/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

interface AuthMeResponse {
  pendingInvitation: { id: string } | null;
  mfa?: { enabled: boolean; required: boolean };
}

export default async function Layout({ children }: { children: React.ReactNode }) {
  const hdrs = await headers();
  const session = await auth.api.getSession({
    headers: hdrs,
  });

  if (!session) {
    return redirect('/auth');
  }

  const meRes = await serverApi.get<AuthMeResponse>('/v1/auth/me');
  // S6: staff (admin / msp_staff) must enable 2FA before using the app.
  const currentPath = hdrs.get('x-pathname') ?? '';
  if (meRes.data?.mfa?.required && !currentPath.startsWith(TWO_FACTOR_SETUP_PATH)) {
    return redirect(TWO_FACTOR_SETUP_PATH);
  }

  const pendingInvite = meRes.data?.pendingInvitation;

  if (pendingInvite) {
    let path = hdrs.get('x-pathname') || hdrs.get('referer') || '';
    path = path.replace(/\/([a-z]{2})\//, '/');
    const target = `/invite/${pendingInvite.id}`;
    if (!path.startsWith(target)) {
      return redirect(target);
    }
  }

  return <>{children}</>;
}
