import {
  emailOTPClient,
  multiSessionClient,
  organizationClient,
  twoFactorClient,
} from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { ac, allRoles } from '@trycompai/auth';

/**
 * The TOTP challenge page lives in the main app. After verifying, it sends the
 * user back to the portal (the session cookie is shared across subdomains).
 */
function handleTwoFactorRedirect(): void {
  if (typeof window === 'undefined') return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return;
  const target = new URL('/auth/two-factor', appUrl);
  target.searchParams.set('redirectTo', window.location.origin);
  window.location.href = target.toString();
}

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333',
  plugins: [
    organizationClient({ ac, roles: allRoles }),
    emailOTPClient(),
    multiSessionClient(),
    twoFactorClient({ onTwoFactorRedirect: handleTwoFactorRedirect }),
  ],
});

export const {
  signIn,
  signOut,
  useSession,
  useActiveOrganization,
  organization,
  useListOrganizations,
  useActiveMember,
} = authClient;
