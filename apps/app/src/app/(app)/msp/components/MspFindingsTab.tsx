'use client';

import { useMspFindings } from '@/hooks/use-msp-lists';
import { mspLinks, useMspTenantSwitch } from '@/hooks/use-msp-tenant-switch';
import {
  Badge,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@trycompai/design-system';
import { EmptyState, formatDate, LoadMore, MSP_COLUMN_CLASSES, OpenButton } from './msp-cells';

function severityVariant(severity: string): 'destructive' | 'secondary' | 'outline' {
  if (severity === 'critical' || severity === 'high') return 'destructive';
  if (severity === 'medium') return 'secondary';
  return 'outline';
}

export function MspFindingsTab() {
  const { rows, hasMore, loadMore, isLoading, error } = useMspFindings();
  const { switchTo, pendingKey } = useMspTenantSwitch();

  if (error) return <EmptyState text="Could not load findings." />;
  if (isLoading) return <EmptyState text="Loading findings..." />;
  if (rows.length === 0) return <EmptyState text="No open findings." />;

  return (
    <Stack gap="md">
      <div className={MSP_COLUMN_CLASSES}>
        <Table variant="bordered">
          <TableHeader>
            <TableRow>
              <TableHead>Finding</TableHead>
              <TableHead data-col="md">Client</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead data-col="lg">Status</TableHead>
              <TableHead data-col="lg">Raised</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.findingId}>
                <TableCell>
                  <div className="max-w-[180px] sm:max-w-[360px]">
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
                <TableCell>
                  <Badge variant={severityVariant(row.severity)}>{row.severity}</Badge>
                </TableCell>
                <TableCell data-col="lg">
                  <Text size="sm" variant="muted">
                    {row.status.replace(/_/g, ' ')}
                  </Text>
                </TableCell>
                <TableCell data-col="lg">
                  <Text size="sm" variant="muted">
                    {formatDate(row.createdAt)}
                  </Text>
                </TableCell>
                <TableCell>
                  <OpenButton
                    label={`Open finding ${row.title}`}
                    loading={pendingKey === row.findingId}
                    onClick={() =>
                      switchTo({
                        organizationId: row.organizationId,
                        href: mspLinks.findings(row.organizationId),
                        key: row.findingId,
                      })
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <LoadMore hasMore={hasMore} onClick={loadMore} />
    </Stack>
  );
}
