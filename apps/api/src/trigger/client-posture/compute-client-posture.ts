import { idempotencyKeys, logger, queue, task } from '@trigger.dev/sdk';
import { createClientPostureService } from './create-client-posture-service';

export const COMPUTE_CLIENT_POSTURE_TASK_ID = 'compute-client-posture';

/** Window during which repeated triggers for the same org collapse into one run. */
export const POSTURE_DEBOUNCE_MINUTES = 10;

const postureQueue = queue({
  name: 'client-posture',
  concurrencyLimit: 10,
});

/**
 * Idempotency key for "recompute this org's posture", bucketed to a
 * POSTURE_DEBOUNCE_MINUTES window so bursts (many check runs finishing close
 * together) produce at most one snapshot per org per window.
 */
export function postureDebounceKey({
  organizationId,
  now = new Date(),
}: {
  organizationId: string;
  now?: Date;
}): string {
  const bucket = Math.floor(
    now.getTime() / (POSTURE_DEBOUNCE_MINUTES * 60 * 1000),
  );
  return `client-posture:${organizationId}:${bucket}`;
}

/** Compute and store one org's posture snapshot. */
export const computeClientPosture = task({
  id: COMPUTE_CLIENT_POSTURE_TASK_ID,
  queue: postureQueue,
  maxDuration: 60 * 5,
  run: async (payload: { organizationId: string }) => {
    const service = createClientPostureService();
    const snapshot = await service.captureSnapshot(payload.organizationId);
    logger.info(`Captured posture snapshot for ${payload.organizationId}`, {
      snapshotId: snapshot.id,
    });
    return snapshot;
  },
});

/**
 * Fire-and-forget, debounced recompute of one org's posture. Never throws:
 * posture is a read model and must not fail the caller (e.g. check runs).
 */
export async function triggerDebouncedClientPosture(
  organizationId: string,
): Promise<void> {
  try {
    const idempotencyKey = await idempotencyKeys.create(
      postureDebounceKey({ organizationId }),
      { scope: 'global' },
    );
    await computeClientPosture.trigger(
      { organizationId },
      {
        idempotencyKey,
        idempotencyKeyTTL: `${POSTURE_DEBOUNCE_MINUTES}m`,
      },
    );
  } catch (error) {
    logger.warn('Failed to trigger client posture recompute', {
      organizationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
