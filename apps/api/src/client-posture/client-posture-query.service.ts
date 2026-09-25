import { Injectable } from '@nestjs/common';
import { db, Prisma } from '@db';
import {
  frameworkScoresSchema,
  type ClientPostureSummary,
  type FrameworkScore,
} from './client-posture.types';

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_POSTURE_HISTORY_DAYS = 90;

interface SnapshotRow {
  organizationId: string;
  capturedAt: Date;
  frameworkScores: Prisma.JsonValue;
  overallScore: number;
  controlsPassing: number;
  controlsTotal: number;
  failingChecks: number;
  overdueTasks: number;
  openFindings: number;
  evidenceExpiring30d: number;
  policiesUnpublished: number;
  integrationErrors: number;
  lastActivityAt: Date | null;
}

function parseFrameworkScores(value: Prisma.JsonValue): FrameworkScore[] {
  const parsed = frameworkScoresSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** Map a stored snapshot row to the API's posture shape. */
export function toPostureSummary(row: SnapshotRow): ClientPostureSummary {
  return {
    capturedAt: row.capturedAt,
    frameworkScores: parseFrameworkScores(row.frameworkScores),
    overallScore: row.overallScore,
    controlsPassing: row.controlsPassing,
    controlsTotal: row.controlsTotal,
    failingChecks: row.failingChecks,
    overdueTasks: row.overdueTasks,
    openFindings: row.openFindings,
    evidenceExpiring30d: row.evidenceExpiring30d,
    policiesUnpublished: row.policiesUnpublished,
    integrationErrors: row.integrationErrors,
    lastActivityAt: row.lastActivityAt,
  };
}

/** Read side of client posture (platform admin views). */
@Injectable()
export class ClientPostureQueryService {
  /**
   * Latest snapshot for each of the given orgs in ONE query
   * (Postgres DISTINCT ON over the [organizationId, capturedAt] index).
   * Orgs without a snapshot are absent from the returned map.
   */
  async getLatestForOrganizations(
    organizationIds: string[],
  ): Promise<Map<string, ClientPostureSummary>> {
    const result = new Map<string, ClientPostureSummary>();
    if (organizationIds.length === 0) return result;

    const rows = await db.$queryRaw<SnapshotRow[]>`
      SELECT DISTINCT ON ("organizationId")
        "organizationId", "capturedAt", "frameworkScores", "overallScore",
        "controlsPassing", "controlsTotal", "failingChecks", "overdueTasks",
        "openFindings", "evidenceExpiring30d", "policiesUnpublished",
        "integrationErrors", "lastActivityAt"
      FROM "ClientPostureSnapshot"
      WHERE "organizationId" IN (${Prisma.join(organizationIds)})
      ORDER BY "organizationId", "capturedAt" DESC
    `;

    for (const row of rows) {
      result.set(row.organizationId, toPostureSummary(row));
    }
    return result;
  }

  /** Snapshots for one org over the last `days` days, oldest first. */
  async getHistory({
    organizationId,
    days,
    now = new Date(),
  }: {
    organizationId: string;
    days: number;
    now?: Date;
  }): Promise<ClientPostureSummary[]> {
    const boundedDays = Math.min(MAX_POSTURE_HISTORY_DAYS, Math.max(1, days));
    const since = new Date(now.getTime() - boundedDays * DAY_MS);

    const rows = await db.clientPostureSnapshot.findMany({
      where: { organizationId, capturedAt: { gte: since } },
      orderBy: { capturedAt: 'asc' },
    });
    return rows.map(toPostureSummary);
  }
}
