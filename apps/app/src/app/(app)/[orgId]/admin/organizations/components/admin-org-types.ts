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
  /** MSP: halopsa. Bound Halo client, null when unmapped. */
  haloClient?: HaloClientRef | null;
}

export interface HaloClientRef {
  id: number;
  name: string | null;
  /** Halo agent UI link, null when HALOPSA_BASE_URL is not set. */
  url: string | null;
}

export interface AdminOrgsResponse {
  data: AdminOrg[];
  total: number;
  page: number;
  limit: number;
}
