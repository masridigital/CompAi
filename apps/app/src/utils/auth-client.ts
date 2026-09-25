import {
  adminClient,
  emailOTPClient,
  magicLinkClient,
  multiSessionClient,
  organizationClient,
  twoFactorClient,
} from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { ac, allRoles } from './permissions';

/**
 * Auth client for browser-side authentication.
 *
 * Points directly to the API server. Cross-subdomain cookies (.trycomp.ai)
 * ensure the session works across all apps (app, portal, etc.).
 *
 * For server-side session validation, use auth.ts instead.
 *
 * SECURITY NOTE: Authentication is handled via httpOnly cookies set by the API.
 * We do not store tokens in localStorage to prevent XSS attacks.
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';

export const authClient = createAuthClient({
  baseURL: BASE_URL,
  plugins: [
    organizationClient({
      ac,
      roles: allRoles,
    }),
    adminClient(),
    emailOTPClient(),
    magicLinkClient(),
    multiSessionClient(),
    twoFactorClient({
      // Email-OTP sign-in answers `{ twoFactorRedirect: true }` for users with
      // 2FA enabled; send them to the TOTP challenge page.
      onTwoFactorRedirect: () => {
        if (typeof window === 'undefined') return;
        window.location.href = '/auth/two-factor';
      },
    }),
  ],
  // Authentication is handled via httpOnly cookies - no localStorage tokens needed
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
