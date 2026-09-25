import { serverApi } from '@/lib/api-server';
import type { Metadata } from 'next';
import Link from 'next/link';
import { TwoFactorSetup } from './components/TwoFactorSetup';

export const metadata: Metadata = {
  title: 'Two-factor authentication | Comp AI',
};

interface AuthMeResponse {
  user: { role: string | null } | null;
  mfa?: { enabled: boolean; required: boolean; enforced?: boolean };
}

/**
 * Account-level 2FA page. Lives outside /[orgId] so staff who are blocked by
 * MFA_REQUIRED can reach it: it only calls the allowlisted /v1/auth/me and the
 * better-auth /two-factor/* endpoints.
 */
export default async function TwoFactorPage() {
  const meRes = await serverApi.get<AuthMeResponse>('/v1/auth/me');
  const mfa = meRes.data?.mfa ?? { enabled: false, required: false, enforced: false };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Account security</h1>
        <p className="text-sm text-muted-foreground">
          Manage two-factor authentication for your Comp AI account.
        </p>
      </div>
      <TwoFactorSetup
        enabled={mfa.enabled}
        canDisable={mfa.enforced !== true}
        required={mfa.required}
      />
      {!mfa.required ? (
        <Link href="/" className="text-sm text-primary underline-offset-4 hover:underline">
          Back to the app
        </Link>
      ) : null}
    </main>
  );
}
