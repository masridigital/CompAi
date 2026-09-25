import type { FrameworkScore, ScoredFramework } from './client-posture.types';

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

export type ControlStatus =
  'completed' | 'not_relevant' | 'in_progress' | 'not_started';

interface ControlInput {
  policies: { status: string | null }[];
  documentTypes: { formType: string; isNotRelevant?: boolean }[];
  tasks: { status: string }[];
}

interface EvidenceSubmission {
  formType: string;
  submittedAt: Date | string;
}

/**
 * Faithful port of `getControlStatus` from apps/app/src/lib/control-compliance.ts
 * (the status the app shows per control). That logic only exists in the app, so
 * it is duplicated here; keep the two in sync.
 */
export function getControlStatus({
  control,
  evidenceSubmissions,
  now = Date.now(),
}: {
  control: ControlInput;
  evidenceSubmissions: EvidenceSubmission[];
  now?: number;
}): ControlStatus {
  const { policies, documentTypes, tasks } = control;

  const allPoliciesDraft =
    !policies.length || policies.every((p) => p.status === 'draft');
  const allTasksTodo = !tasks.length || tasks.every((t) => t.status === 'todo');
  const allPoliciesPublished =
    policies.length > 0 && policies.every((p) => p.status === 'published');
  const allTasksDone =
    tasks.length > 0 &&
    tasks.every((t) => t.status === 'done' || t.status === 'not_relevant');

  const relevantDocumentTypes = documentTypes.filter(
    (dt) => dt.isNotRelevant !== true,
  );
  const hasDocumentRequirements = relevantDocumentTypes.length > 0;
  const hasNotRelevantDocumentRequirements = documentTypes.some(
    (dt) => dt.isNotRelevant === true,
  );

  const sorted = [...evidenceSubmissions].sort(
    (a, b) =>
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  );
  let allDocumentsFresh = true;
  let anyDocumentSubmitted = false;
  for (const dt of relevantDocumentTypes) {
    const latest = sorted.find((es) => es.formType === dt.formType);
    if (!latest) {
      allDocumentsFresh = false;
      continue;
    }
    anyDocumentSubmitted = true;
    if (now - new Date(latest.submittedAt).getTime() > SIX_MONTHS_MS) {
      allDocumentsFresh = false;
    }
  }

  const policiesComplete = policies.length === 0 || allPoliciesPublished;
  const tasksComplete = tasks.length === 0 || allTasksDone;
  const documentsComplete = !hasDocumentRequirements || allDocumentsFresh;

  if (policiesComplete && tasksComplete && documentsComplete) {
    const hasAnyArtifact =
      policies.length > 0 || tasks.length > 0 || hasDocumentRequirements;
    if (hasAnyArtifact) return 'completed';
    if (hasNotRelevantDocumentRequirements) return 'not_relevant';
  }

  if (allPoliciesDraft && allTasksTodo && !anyDocumentSubmitted) {
    return 'not_started';
  }
  return 'in_progress';
}

/**
 * Count unique controls across all framework instances and how many of them
 * are passing (`completed` or `not_relevant`, as the app renders them).
 * Tasks are matched to controls through FrameworkControlTaskLink.
 */
export function countControls({
  frameworks,
  tasks,
  evidenceSubmissions,
  now = Date.now(),
}: {
  frameworks: ScoredFramework[];
  tasks: { status: string; controlIds: string[] }[];
  evidenceSubmissions: EvidenceSubmission[];
  now?: number;
}): { controlsPassing: number; controlsTotal: number } {
  const controls = new Map<string, ScoredFramework['controls'][number]>();
  for (const framework of frameworks) {
    for (const control of framework.controls) {
      if (!controls.has(control.id)) controls.set(control.id, control);
    }
  }

  let controlsPassing = 0;
  for (const control of controls.values()) {
    const status = getControlStatus({
      control: {
        policies: control.policies,
        documentTypes: control.controlDocumentTypes,
        tasks: tasks.filter((t) => t.controlIds.includes(control.id)),
      },
      evidenceSubmissions,
      now,
    });
    if (status === 'completed' || status === 'not_relevant') controlsPassing++;
  }

  return { controlsPassing, controlsTotal: controls.size };
}

/** Map FrameworksService scores to the snapshot's `frameworkScores` shape. */
export function toFrameworkScores(
  frameworks: ScoredFramework[],
): FrameworkScore[] {
  return frameworks.map((fw) => ({
    frameworkId: fw.frameworkId ?? fw.customFrameworkId ?? fw.id,
    name: fw.framework?.name ?? fw.customFramework?.name ?? 'Framework',
    score: Math.min(100, Math.max(0, Math.round(fw.complianceScore))),
  }));
}

/** Overall score: mean of the framework scores (0 when there are none). */
export function averageScore(scores: FrameworkScore[]): number {
  if (scores.length === 0) return 0;
  const total = scores.reduce((sum, s) => sum + s.score, 0);
  return Math.round(total / scores.length);
}
