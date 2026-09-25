import type { HaloCustomFieldValue } from '@trycompai/integration-platform';

export const DEFAULT_CUSTOM_FIELD_PREFIX = 'CFCompAI';
export const MAX_FRAMEWORKS_TEXT_LENGTH = 250;

export interface PostureSnapshotLike {
  overallScore: number;
  failingChecks: number;
  openFindings: number;
  capturedAt: Date;
  frameworkScores: Array<{ name: string; score: number }>;
}

/** Custom field name prefix from HALOPSA_CUSTOM_FIELD_PREFIX (letters, digits, underscore). */
export function customFieldPrefix(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.HALOPSA_CUSTOM_FIELD_PREFIX?.trim();
  return raw && /^[A-Za-z][A-Za-z0-9_]*$/.test(raw) ? raw : DEFAULT_CUSTOM_FIELD_PREFIX;
}

/** "SOC 2 82%, ISO 27001 64%", cut at a whole entry to fit `max` characters. */
export function formatFrameworkScores(
  scores: Array<{ name: string; score: number }>,
  max = MAX_FRAMEWORKS_TEXT_LENGTH,
): string {
  let out = '';
  for (const { name, score } of scores) {
    const entry = `${name.replace(/[\r\n,]+/g, ' ').trim()} ${Math.round(score)}%`;
    const next = out ? `${out}, ${entry}` : entry;
    if (next.length > max) {
      if (!out) return `${entry.slice(0, max - 1)}…`;
      break;
    }
    out = next;
  }
  return out;
}

/** Plan 5.3 client custom field values for one org's latest snapshot. */
export function buildPostureFields({
  snapshot,
  organizationId,
  appUrl,
  prefix = DEFAULT_CUSTOM_FIELD_PREFIX,
}: {
  snapshot: PostureSnapshotLike;
  organizationId: string;
  appUrl: string;
  prefix?: string;
}): Record<string, HaloCustomFieldValue> {
  return {
    [`${prefix}Score`]: snapshot.overallScore,
    [`${prefix}Frameworks`]: formatFrameworkScores(snapshot.frameworkScores),
    [`${prefix}FailingChecks`]: snapshot.failingChecks,
    [`${prefix}OpenFindings`]: snapshot.openFindings,
    [`${prefix}LastSync`]: snapshot.capturedAt.toISOString().slice(0, 10),
    [`${prefix}Url`]: `${appUrl}/${encodeURIComponent(organizationId)}`,
  };
}
