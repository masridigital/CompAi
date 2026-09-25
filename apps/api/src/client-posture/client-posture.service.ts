import { Injectable, Logger } from '@nestjs/common';
import { db } from '@db';
import { FrameworksService } from '../frameworks/frameworks.service';
import { CheckResultsService } from '../integration-platform/services/check-results.service';
import { loadControlInputs, loadPostureCounts } from './client-posture-counts';
import {
  averageScore,
  countControls,
  toFrameworkScores,
} from './client-posture-metrics';
import {
  scoredFrameworkSchema,
  type ClientPostureMetrics,
  type ScoredFramework,
} from './client-posture.types';

export const POSTURE_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Computes and persists `ClientPostureSnapshot` rows — the read model behind
 * the platform admin client posture columns.
 *
 * Reuses existing logic wherever it exists:
 * - framework scores: `FrameworksService.findAll(..., { includeScores })`,
 *   the same numbers the Frameworks page and overview dashboard show;
 * - failing checks: `CheckResultsService.getLatestResultsByCheck` (latest REAL
 *   run per connection + check);
 * - control status: a port of the app's `getControlStatus`
 *   (see client-posture-metrics.ts).
 */
@Injectable()
export class ClientPostureService {
  private readonly logger = new Logger(ClientPostureService.name);

  constructor(
    private readonly frameworksService: FrameworksService,
    private readonly checkResults: CheckResultsService,
  ) {}

  async computeSnapshot({
    organizationId,
    now = new Date(),
  }: {
    organizationId: string;
    now?: Date;
  }): Promise<ClientPostureMetrics> {
    const [frameworks, controlInputs, failingChecks, counts] =
      await Promise.all([
        this.loadScoredFrameworks(organizationId),
        loadControlInputs(organizationId),
        this.countFailingChecks(organizationId),
        loadPostureCounts({ organizationId, now }),
      ]);

    const frameworkScores = toFrameworkScores(frameworks);
    const { controlsPassing, controlsTotal } = countControls({
      frameworks,
      tasks: controlInputs.tasks,
      evidenceSubmissions: controlInputs.evidenceSubmissions,
      now: now.getTime(),
    });

    return {
      frameworkScores,
      overallScore: averageScore(frameworkScores),
      controlsPassing,
      controlsTotal,
      failingChecks,
      ...counts,
    };
  }

  /** Compute the posture of one org and store it as a new snapshot row. */
  async captureSnapshot(organizationId: string) {
    const metrics = await this.computeSnapshot({ organizationId });
    return db.clientPostureSnapshot.create({
      data: { organizationId, ...metrics },
      select: { id: true, organizationId: true, capturedAt: true },
    });
  }

  /** Delete snapshots older than the retention window. Returns rows deleted. */
  async pruneSnapshots({
    retentionDays = POSTURE_RETENTION_DAYS,
    now = new Date(),
  }: { retentionDays?: number; now?: Date } = {}): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
    const result = await db.clientPostureSnapshot.deleteMany({
      where: { capturedAt: { lt: cutoff } },
    });
    return result.count;
  }

  private async loadScoredFrameworks(
    organizationId: string,
  ): Promise<ScoredFramework[]> {
    const raw: unknown = await this.frameworksService.findAll(organizationId, {
      includeControls: true,
      includeScores: true,
    });
    if (!Array.isArray(raw)) return [];

    const parsed: ScoredFramework[] = [];
    for (const item of raw) {
      const result = scoredFrameworkSchema.safeParse(item);
      if (result.success) {
        parsed.push(result.data);
        continue;
      }
      this.logger.warn(
        `Skipping unparseable framework instance for org ${organizationId}`,
      );
    }
    return parsed;
  }

  /**
   * Number of integration checks (connection + check pairs) whose latest real
   * run has at least one failing resource. Disconnected connections are
   * ignored, matching CheckResultsService's "latest REAL run" semantics.
   */
  private async countFailingChecks(organizationId: string): Promise<number> {
    // GROUP BY in SQL (Prisma's `distinct` dedupes in memory over every run).
    const pairs = await db.integrationCheckRun.groupBy({
      by: ['connectionId', 'checkId'],
      where: {
        connection: { organizationId, status: { not: 'disconnected' } },
      },
    });

    const results = await Promise.all(
      pairs.map((pair) =>
        this.checkResults.getLatestResultsByCheck({
          organizationId,
          connectionId: pair.connectionId,
          checkId: pair.checkId,
        }),
      ),
    );

    return results.filter((rows) => rows.some((row) => !row.passed)).length;
  }
}
