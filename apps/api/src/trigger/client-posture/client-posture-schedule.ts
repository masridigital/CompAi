import { db } from '@db';
import { logger, schedules } from '@trigger.dev/sdk';
import { POSTURE_RETENTION_DAYS } from '../../client-posture/client-posture.service';
import { computeClientPosture } from './compute-client-posture';
import { createClientPostureService } from './create-client-posture-service';

export const POSTURE_ORG_BATCH_SIZE = 100;

/**
 * Split org ids into batchTrigger payload chunks. Pure + exported for tests.
 */
export function buildPostureBatches({
  organizationIds,
  batchSize = POSTURE_ORG_BATCH_SIZE,
}: {
  organizationIds: string[];
  batchSize?: number;
}): Array<Array<{ payload: { organizationId: string } }>> {
  const batches: Array<Array<{ payload: { organizationId: string } }>> = [];
  for (let i = 0; i < organizationIds.length; i += batchSize) {
    batches.push(
      organizationIds
        .slice(i, i + batchSize)
        .map((organizationId) => ({ payload: { organizationId } })),
    );
  }
  return batches;
}

/**
 * Fan out one compute-client-posture run per org, then prune old snapshots.
 * Exported (separately from the schedule wrapper) so it can be unit tested.
 */
export async function runClientPostureFanOut(): Promise<{
  orgsTriggered: number;
  snapshotsPruned: number;
}> {
  // Orgs that are live customers or finished onboarding; abandoned sign-ups
  // have nothing meaningful to report.
  const organizations = await db.organization.findMany({
    where: { OR: [{ hasAccess: true }, { onboardingCompleted: true }] },
    select: { id: true },
  });

  const batches = buildPostureBatches({
    organizationIds: organizations.map((o) => o.id),
  });

  let orgsTriggered = 0;
  for (const batch of batches) {
    await computeClientPosture.batchTrigger(batch);
    orgsTriggered += batch.length;
  }

  const snapshotsPruned = await createClientPostureService().pruneSnapshots({
    retentionDays: POSTURE_RETENTION_DAYS,
  });

  logger.info(
    `Client posture: triggered ${orgsTriggered} org(s), pruned ${snapshotsPruned} snapshot(s)`,
  );
  return { orgsTriggered, snapshotsPruned };
}

/** Nightly client posture snapshot (05:30 UTC, before the 06:00 check run). */
export const clientPostureSchedule = schedules.task({
  id: 'client-posture-schedule',
  cron: '30 5 * * *',
  maxDuration: 60 * 30,
  run: async () => runClientPostureFanOut(),
});
