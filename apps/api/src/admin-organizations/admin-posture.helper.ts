import type { ClientPostureSummary } from '../client-posture/client-posture.types';

/**
 * Attach each org's latest posture snapshot (or null when none exists yet) to
 * an admin organizations list page. Pure + exported for unit testing.
 */
export function attachPosture<T extends { id: string }>({
  organizations,
  postureByOrg,
}: {
  organizations: T[];
  postureByOrg: Map<string, ClientPostureSummary>;
}): Array<T & { posture: ClientPostureSummary | null }> {
  return organizations.map((org) => ({
    ...org,
    posture: postureByOrg.get(org.id) ?? null,
  }));
}
