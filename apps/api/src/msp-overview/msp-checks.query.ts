import { Injectable } from '@nestjs/common';
import { db } from '@db';
import { CheckResultsService } from '../integration-platform/services/check-results.service';
import {
  canReadInOrg,
  orgIdsWithRead,
  orgNameMap,
  type MspScope,
} from './msp-scope';

/** Max concurrent CheckResultsService lookups (one per connection + check). */
const LOOKUP_CONCURRENCY = 10;

export interface MspFailingCheckRow {
  organizationId: string;
  orgName: string;
  connectionId: string;
  provider: string;
  checkId: string;
  checkName: string;
  failingResources: number;
  lastRunAt: Date | null;
  /** Task the run verified, only when the viewer may read tasks in that org. */
  taskId: string | null;
}

interface FailingPair {
  connectionId: string;
  checkId: string;
  runId: string;
  failingResources: number;
}

async function mapInBatches<T, R>({
  items,
  size,
  fn,
}: {
  items: T[];
  size: number;
  fn: (item: T) => Promise<R>;
}): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

/**
 * Latest failing integration checks per org. Pair discovery is one grouped
 * query over the orgs where the viewer has `integration:read`; results come
 * from CheckResultsService (latest REAL run per connection + check), the same
 * source the posture snapshot's `failingChecks` count uses.
 */
@Injectable()
export class MspChecksQuery {
  constructor(private readonly checkResults: CheckResultsService) {}

  async listFailing(scope: MspScope): Promise<{ data: MspFailingCheckRow[] }> {
    const orgIds = orgIdsWithRead({ scope, resource: 'integration' });
    if (orgIds.length === 0) return { data: [] };

    const connections = await db.integrationConnection.findMany({
      where: {
        organizationId: { in: orgIds },
        status: { not: 'disconnected' },
      },
      select: {
        id: true,
        organizationId: true,
        provider: { select: { slug: true } },
      },
    });
    if (connections.length === 0) return { data: [] };
    const connectionById = new Map(connections.map((c) => [c.id, c]));

    const pairs = await db.integrationCheckRun.groupBy({
      by: ['connectionId', 'checkId'],
      where: { connectionId: { in: connections.map((c) => c.id) } },
    });

    const failing = (
      await mapInBatches({
        items: pairs,
        size: LOOKUP_CONCURRENCY,
        fn: async (pair): Promise<FailingPair | null> => {
          const connection = connectionById.get(pair.connectionId);
          if (!connection) return null;
          const rows = await this.checkResults.getLatestResultsByCheck({
            organizationId: connection.organizationId,
            connectionId: pair.connectionId,
            checkId: pair.checkId,
          });
          const failed = rows.filter((row) => !row.passed);
          if (failed.length === 0) return null;
          return {
            connectionId: pair.connectionId,
            checkId: pair.checkId,
            runId: failed[0].runId,
            failingResources: failed.length,
          };
        },
      })
    ).filter((pair): pair is FailingPair => pair !== null);
    if (failing.length === 0) return { data: [] };

    const runs = await db.integrationCheckRun.findMany({
      where: {
        id: { in: failing.map((f) => f.runId) },
        connectionId: { in: connections.map((c) => c.id) },
      },
      select: {
        id: true,
        checkName: true,
        completedAt: true,
        createdAt: true,
        taskId: true,
        task: { select: { organizationId: true } },
      },
    });
    const runById = new Map(runs.map((run) => [run.id, run]));
    const names = orgNameMap(scope);

    const data = failing.flatMap((pair): MspFailingCheckRow[] => {
      const connection = connectionById.get(pair.connectionId);
      if (!connection) return [];
      const organizationId = connection.organizationId;
      const run = runById.get(pair.runId);
      const taskVisible =
        !!run?.taskId &&
        run.task?.organizationId === organizationId &&
        canReadInOrg({ scope, organizationId, resource: 'task' });
      return [
        {
          organizationId,
          orgName: names.get(organizationId) ?? '',
          connectionId: pair.connectionId,
          provider: connection.provider.slug,
          checkId: pair.checkId,
          checkName: run?.checkName ?? pair.checkId,
          failingResources: pair.failingResources,
          lastRunAt: run?.completedAt ?? run?.createdAt ?? null,
          taskId: taskVisible && run?.taskId ? run.taskId : null,
        },
      ];
    });

    data.sort(
      (a, b) =>
        a.orgName.localeCompare(b.orgName) ||
        a.checkName.localeCompare(b.checkName),
    );
    return { data };
  }
}
