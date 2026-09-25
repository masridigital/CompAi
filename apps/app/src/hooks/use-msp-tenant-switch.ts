'use client';

import { authClient } from '@/utils/auth-client';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

/**
 * Switch the active tenant and open a deep link inside it — the same two steps
 * the organization switcher uses (`organization.setActive`, then navigate).
 */
export function useMspTenantSwitch() {
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const switchTo = useCallback(
    async ({
      organizationId,
      href,
      key,
    }: {
      organizationId: string;
      href: string;
      key?: string;
    }) => {
      setPendingKey(key ?? href);
      try {
        await authClient.organization.setActive({ organizationId });
        router.push(href);
      } catch {
        setPendingKey(null);
      }
    },
    [router],
  );

  return { switchTo, pendingKey };
}

/** Deep links used by the master pane's "Open" actions. */
export const mspLinks = {
  client: (orgId: string) => `/${orgId}`,
  task: ({ orgId, taskId }: { orgId: string; taskId: string }) => `/${orgId}/tasks/${taskId}`,
  findings: (orgId: string) => `/${orgId}/overview/findings`,
  integrations: (orgId: string) => `/${orgId}/integrations`,
};
