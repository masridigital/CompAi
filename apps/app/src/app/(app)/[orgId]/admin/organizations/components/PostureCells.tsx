import { Badge, Text } from '@trycompai/design-system';
import type { ClientPosture } from './admin-org-types';

/**
 * Responsive column visibility for the organizations table. DS table cells
 * don't accept className, so cells carry `data-col` and the wrapper div hides
 * them below a breakpoint (see COLUMN_VISIBILITY_CLASSES).
 */
export type ColumnBreakpoint = 'md' | 'lg' | 'xl';

export const COLUMN_VISIBILITY_CLASSES = [
  '[&_[data-col=md]]:hidden md:[&_[data-col=md]]:table-cell',
  '[&_[data-col=lg]]:hidden lg:[&_[data-col=lg]]:table-cell',
  '[&_[data-col=xl]]:hidden xl:[&_[data-col=xl]]:table-cell',
].join(' ');

function scoreVariant(score: number): 'default' | 'secondary' | 'destructive' {
  if (score >= 80) return 'default';
  if (score >= 50) return 'secondary';
  return 'destructive';
}

export function PostureScore({ posture }: { posture: ClientPosture | null | undefined }) {
  if (!posture) {
    return (
      <Text size="xs" variant="muted">
        No data
      </Text>
    );
  }

  const frameworks = posture.frameworkScores.map((fw) => `${fw.name}: ${fw.score}%`).join(', ');

  return (
    <div title={frameworks || 'No frameworks'}>
      <Badge variant={scoreVariant(posture.overallScore)}>{posture.overallScore}%</Badge>
    </div>
  );
}

export function PostureCount({
  posture,
  value,
  label,
}: {
  posture: ClientPosture | null | undefined;
  value: (posture: ClientPosture) => number;
  label: string;
}) {
  if (!posture) {
    return (
      <Text size="sm" variant="muted">
        —
      </Text>
    );
  }

  const count = value(posture);
  return (
    <div aria-label={`${label}: ${count}`}>
      <Text size="sm" variant={count > 0 ? 'destructive' : 'muted'}>
        {count}
      </Text>
    </div>
  );
}
