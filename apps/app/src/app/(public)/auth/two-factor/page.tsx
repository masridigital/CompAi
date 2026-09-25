import { env } from '@/env.mjs';
import type { Metadata } from 'next';
import { TwoFactorChallenge } from './components/TwoFactorChallenge';

export const metadata: Metadata = {
  title: 'Two-factor authentication | Comp AI',
};

/**
 * Sign-in 2FA challenge. Reached after magic link / OAuth / email OTP when the
 * account has 2FA on: the API has set a signed `two_factor` cookie but no
 * session yet. Verifying the code creates the session.
 */
export default async function TwoFactorChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const { redirectTo } = await searchParams;

  return (
    <div className="flex min-h-dvh flex-col text-foreground">
      <main className="flex flex-1 items-center justify-center p-4 sm:p-6">
        <TwoFactorChallenge redirectTo={redirectTo} portalUrl={env.NEXT_PUBLIC_PORTAL_URL} />
      </main>
    </div>
  );
}
