'use client';

import { useMspTasks } from '@/hooks/use-msp-lists';
import { mspLinks, useMspTenantSwitch } from '@/hooks/use-msp-tenant-switch';
import {
  Badge,
  Button,
  HStack,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@trycompai/design-system';
import { useState } from 'react';
import { EmptyState, formatDate, LoadMore, MSP_COLUMN_CLASSES, OpenButton } from './msp-cells';

type TaskView = 'overdue' | 'due-soon';

export function MspTasksTab() {
  const [view, setView] = useState<TaskView>('overdue');
  const { rows, hasMore, loadMore, isLoading, error } = useMspTasks({ view });
  const { switchTo, pendingKey } = useMspTenantSwitch();

  return (
    <Stack gap="md">
      <HStack gap="xs">
        <Button
          size="sm"
          variant={view === 'overdue' ? 'default' : 'outline'}
          onClick={() => setView('overdue')}
        >
          Overdue
        </Button>
        <Button
          size="sm"
          variant={view === 'due-soon' ? 'default' : 'outline'}
          onClick={() => setView('due-soon')}
        >
          Due in 30 days
        </Button>
      </HStack>

      {error ? <EmptyState text="Could not load tasks." /> : null}
      {!error && isLoading ? <EmptyState text="Loading tasks..." /> : null}
      {!error && !isLoading && rows.length === 0 ? (
        <EmptyState text={view === 'overdue' ? 'No overdue tasks.' : 'Nothing due soon.'} />
      ) : null}

      {rows.length > 0 ? (
        <div className={MSP_COLUMN_CLASSES}>
          <Table variant="bordered">
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead data-col="md">Client</TableHead>
                <TableHead data-col="lg">Status</TableHead>
                <TableHead data-col="lg">Assignee</TableHead>
                <TableHead>Review date</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.organizationId}:${row.taskId}`}>
                  <TableCell>
                    <div className="max-w-[180px] sm:max-w-[320px]">
                      <div className="truncate">
                        <Text size="sm" weight="medium">
                          {row.title}
                        </Text>
                      </div>
                      <div className="truncate md:hidden">
                        <Text size="xs" variant="muted">
                          {row.orgName}
                        </Text>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell data-col="md">
                    <div className="max-w-[200px] truncate">
                      <Text size="sm">{row.orgName}</Text>
                    </div>
                  </TableCell>
                  <TableCell data-col="lg">
                    <Badge variant="outline">{row.status.replace(/_/g, ' ')}</Badge>
                  </TableCell>
                  <TableCell data-col="lg">
                    <Text size="sm" variant="muted">
                      {row.assigneeName ?? 'Unassigned'}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Text size="sm">{formatDate(row.reviewDate)}</Text>
                  </TableCell>
                  <TableCell>
                    <OpenButton
                      label={`Open task ${row.title}`}
                      loading={pendingKey === row.taskId}
                      onClick={() =>
                        switchTo({
                          organizationId: row.organizationId,
                          href: mspLinks.task({ orgId: row.organizationId, taskId: row.taskId }),
                          key: row.taskId,
                        })
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      <LoadMore hasMore={hasMore} onClick={loadMore} />
    </Stack>
  );
}
