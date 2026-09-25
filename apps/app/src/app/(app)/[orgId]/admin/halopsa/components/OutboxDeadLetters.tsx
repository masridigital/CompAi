'use client';

import { retryHaloOutboxEvent, useHaloDeadOutbox } from '@/hooks/use-admin-halopsa';
import {
  Badge,
  Button,
  Section,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@trycompai/design-system';
import { useState } from 'react';
import { toast } from 'sonner';

export function OutboxDeadLetters() {
  const { events, error, isLoading, mutate } = useHaloDeadOutbox();
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const handleRetry = async (id: string) => {
    setRetryingId(id);
    const response = await retryHaloOutboxEvent({ id });
    setRetryingId(null);
    if (response.error) {
      toast.error(response.error);
      return;
    }
    toast.success('Queued for retry');
    void mutate();
  };

  return (
    <Section
      title="Failed deliveries"
      description="Halo writes that failed 8 times. Fix the cause, then retry."
      actions={
        <Button size="sm" variant="outline" onClick={() => mutate()}>
          Refresh
        </Button>
      }
    >
      {error && (
        <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
          Could not load the outbox: {error.message}
        </div>
      )}
      {isLoading && <div className="py-8 text-center text-sm text-muted-foreground">Loading outbox...</div>}
      {!isLoading && !error && events.length === 0 && (
        <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
          No failed deliveries.
        </div>
      )}
      {!isLoading && events.length > 0 && (
        <Table variant="bordered">
          <TableHeader>
            <TableRow>
              <TableHead>Organization</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Last error</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell>
                  <div className="max-w-48 truncate">{event.organization?.name ?? event.organizationId}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{event.kind}</Badge>
                </TableCell>
                <TableCell>
                  <Text size="sm">{String(event.attempts)}</Text>
                </TableCell>
                <TableCell>
                  <div className="max-w-80 truncate text-xs text-muted-foreground" title={event.lastError ?? ''}>
                    {event.lastError ?? '—'}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="whitespace-nowrap text-xs">{new Date(event.createdAt).toLocaleString()}</div>
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={retryingId === event.id}
                    onClick={() => handleRetry(event.id)}
                  >
                    Retry
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
