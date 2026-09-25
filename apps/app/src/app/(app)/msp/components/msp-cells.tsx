'use client';

import { Badge, Button, Text } from '@trycompai/design-system';
import { Launch } from '@trycompai/design-system/icons';

/**
 * Responsive column visibility. DS table cells don't accept className, so
 * secondary cells carry `data-col` and the table wrapper hides them below a
 * breakpoint. The DS Table scrolls horizontally inside its own container.
 */
export const MSP_COLUMN_CLASSES = [
  '[&_[data-col=md]]:hidden md:[&_[data-col=md]]:table-cell',
  '[&_[data-col=lg]]:hidden lg:[&_[data-col=lg]]:table-cell',
  '[&_[data-col=xl]]:hidden xl:[&_[data-col=xl]]:table-cell',
].join(' ');

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function scoreVariant(score: number): 'default' | 'secondary' | 'destructive' {
  if (score >= 80) return 'default';
  if (score >= 50) return 'secondary';
  return 'destructive';
}

export function ScoreCell({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) {
    return (
      <Text size="xs" variant="muted">
        —
      </Text>
    );
  }
  return <Badge variant={scoreVariant(score)}>{score}%</Badge>;
}

/** A count, or a dash when there is no data or the viewer may not read it. */
export function CountCell({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return (
      <Text size="xs" variant="muted">
        —
      </Text>
    );
  }
  return (
    <Text
      size="sm"
      weight={value > 0 ? 'semibold' : 'normal'}
      variant={value > 0 ? 'default' : 'muted'}
    >
      {value}
    </Text>
  );
}

export function OpenButton({
  label,
  loading,
  onClick,
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      iconLeft={<Launch size={16} />}
      loading={loading}
      onClick={onClick}
      aria-label={label}
    >
      Open
    </Button>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-lg border border-dashed px-4 text-center">
      <Text variant="muted">{text}</Text>
    </div>
  );
}

export function LoadMore({ hasMore, onClick }: { hasMore: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center pt-2">
      <Button variant="outline" onClick={onClick}>
        Load more
      </Button>
    </div>
  );
}
