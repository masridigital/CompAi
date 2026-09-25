export interface FrameworkScore {
  frameworkId: string;
  name: string;
  score: number;
}

/** Latest ClientPostureSnapshot for an org, as returned by the admin API. */
export interface ClientPosture {
  capturedAt: string;
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
  lastActivityAt: string | null;
}

export interface AdminOrg {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  createdAt: string;
  hasAccess: boolean;
  onboardingCompleted: boolean;
  memberCount: number;
  owner: { id: string; name: string; email: string } | null;
  /** Null until the first posture snapshot has been captured. */
  posture?: ClientPosture | null;
}

export interface AdminOrgsResponse {
  data: AdminOrg[];
  total: number;
  page: number;
  limit: number;
}
