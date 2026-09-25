import { z } from 'zod';

/** One entry of `ClientPostureSnapshot.frameworkScores`. */
export const frameworkScoreSchema = z.object({
  frameworkId: z.string(),
  name: z.string(),
  score: z.number().int().min(0).max(100),
});
export type FrameworkScore = z.infer<typeof frameworkScoreSchema>;

export const frameworkScoresSchema = z.array(frameworkScoreSchema);

/** The computed (not yet persisted) posture of one organization. */
export interface ClientPostureMetrics {
  frameworkScores: FrameworkScore[];
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

/** Posture as returned by the admin API (latest snapshot per org). */
export interface ClientPostureSummary extends ClientPostureMetrics {
  capturedAt: Date;
}

/**
 * Shape of `FrameworksService.findAll(orgId, { includeControls, includeScores })`
 * that posture reads. That method is loosely typed (it maps over `any`), so we
 * validate the fields we consume at this edge instead of trusting a cast.
 */
export const scoredFrameworkSchema = z.object({
  id: z.string(),
  frameworkId: z.string().nullish(),
  customFrameworkId: z.string().nullish(),
  framework: z.object({ name: z.string() }).nullish(),
  customFramework: z.object({ name: z.string() }).nullish(),
  complianceScore: z.number().default(0),
  controls: z
    .array(
      z.object({
        id: z.string(),
        policies: z
          .array(z.object({ status: z.string().nullable() }))
          .default([]),
        controlDocumentTypes: z
          .array(
            z.object({
              formType: z.string(),
              isNotRelevant: z.boolean().optional(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});
export type ScoredFramework = z.infer<typeof scoredFrameworkSchema>;
