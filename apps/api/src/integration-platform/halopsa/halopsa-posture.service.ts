import { Injectable, Logger } from '@nestjs/common';
import { db } from '@db';
import { parseHaloAlertSettings } from '@trycompai/integration-platform';
import { ClientPostureQueryService } from '../../client-posture/client-posture-query.service';
import { toVariableValues } from './halopsa-connection';
import { buildPostureFields, customFieldPrefix } from './halopsa-posture-fields';
import { ensureSystemLink } from './halopsa-system-link';
import { appBaseUrl, HALOPSA_PROVIDER_SLUG } from './halopsa.constants';

/** Snapshots older than this are not pushed (the nightly snapshot failed). */
export const MAX_SNAPSHOT_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export interface PosturePushResult {
  connections: number;
  enqueued: number;
  disabled: number;
  noSnapshot: number;
  stale: number;
}

/**
 * Plan 5.3: enqueue one `push_custom_fields` outbox event per org with an
 * active halopsa connection and a recent posture snapshot. DI-free so the
 * Trigger.dev task can use `new HaloPostureService()`.
 */
@Injectable()
export class HaloPostureService {
  private readonly logger = new Logger(HaloPostureService.name);

  constructor(private readonly postureQuery: ClientPostureQueryService = new ClientPostureQueryService()) {}

  async enqueueAll({ now = new Date() }: { now?: Date } = {}): Promise<PosturePushResult> {
    const connections = await db.integrationConnection.findMany({
      where: { status: 'active', provider: { slug: HALOPSA_PROVIDER_SLUG } },
      select: { id: true, organizationId: true, variables: true },
      orderBy: { createdAt: 'asc' },
    });

    // One connection per org (the oldest active one, matching alerting).
    const byOrg = new Map<string, (typeof connections)[number]>();
    for (const connection of connections) {
      if (!byOrg.has(connection.organizationId)) byOrg.set(connection.organizationId, connection);
    }

    const result: PosturePushResult = { connections: byOrg.size, enqueued: 0, disabled: 0, noSnapshot: 0, stale: 0 };
    const enabled = [...byOrg.values()].filter((c) => {
      const on = parseHaloAlertSettings(toVariableValues(c.variables)).pushPosture;
      if (!on) result.disabled++;
      return on;
    });
    if (enabled.length === 0) return result;

    const snapshots = await this.postureQuery.getLatestForOrganizations(enabled.map((c) => c.organizationId));
    const prefix = customFieldPrefix();
    const appUrl = appBaseUrl();

    for (const connection of enabled) {
      const snapshot = snapshots.get(connection.organizationId);
      if (!snapshot) {
        result.noSnapshot++;
        continue;
      }
      if (now.getTime() - snapshot.capturedAt.getTime() > MAX_SNAPSHOT_AGE_MS) {
        result.stale++;
        this.logger.warn(`Posture snapshot for ${connection.organizationId} is stale; not pushed`);
        continue;
      }
      const fields = buildPostureFields({ snapshot, organizationId: connection.organizationId, appUrl, prefix });
      await this.enqueue({ organizationId: connection.organizationId, connectionId: connection.id, fields, now });
      result.enqueued++;
    }
    return result;
  }

  private async enqueue({
    organizationId,
    connectionId,
    fields,
    now,
  }: {
    organizationId: string;
    connectionId: string;
    fields: Record<string, string | number>;
    now: Date;
  }): Promise<void> {
    await db.$transaction(async (tx) => {
      const link = await ensureSystemLink({
        tx,
        organizationId,
        connectionId,
        entityType: 'posture',
        dedupKey: 'posture',
        now,
      });
      // Only the newest values matter: supersede any push still waiting.
      await tx.haloOutboxEvent.updateMany({
        where: { linkId: link.id, kind: 'push_custom_fields', status: 'pending' },
        data: { status: 'done', lastError: 'superseded by a newer posture push' },
      });
      await tx.haloOutboxEvent.create({
        data: { organizationId, linkId: link.id, kind: 'push_custom_fields', payload: { fields }, nextAttemptAt: now },
      });
    });
  }
}
