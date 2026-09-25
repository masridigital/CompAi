'use client';

import { useMspFailingChecks } from '@/hooks/use-msp-lists';
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
import { EmptyState, formatDate, MSP_COLUMN_CLASSES, OpenButton } from './msp-cells';

export function MspChecksTab() {
  const { rows, isLoading, error } = useMspFailingChecks();
  const { switchTo, pendingKey } = useMspTenantSwitch();

  if (error) return <EmptyState text="Could not load failing checks." />;
  if (isLoading) return <EmptyState text="Loading failing checks..." />;
  if (rows.length === 0) return <EmptyState text="No failing integration checks." />;

  return (
    <Stack gap="md">
      <div className={MSP_COLUMN_CLASSES}>
        <Table variant="bordered">
          <TableHeader>
            <TableRow>
              <TableHead>Check</TableHead>
              <TableHead data-col="md">Client</TableHead>
              <TableHead data-col="lg">Integration</TableHead>
              <TableHead>Failing</TableHead>
              <TableHead data-col="lg">Last run</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const key = `${row.connectionId}:${row.checkId}`;
              return (
                <TableRow key={key}>
                  <TableCell>
                    <div className="max-w-[180px] sm:max-w-[320px]">
                      <div className="truncate">
                        <Text size="sm" weight="medium">
                          {row.checkName}
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
                    <Badge variant="outline">{row.provider}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="destructive">{row.failingResources}</Badge>
                  </TableCell>
                  <TableCell data-col="lg">
                    <Text size="sm" variant="muted">
                      {formatDate(row.lastRunAt)}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <OpenButton
                      label={`Open ${row.checkName} for ${row.orgName}`}
                      loading={pendingKey === key}
                      onClick={() =>
                        switchTo({
                          organizationId: row.organizationId,
                          href: mspLinks.integrations(row.organizationId),
                          key,
                        })
                      }
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Stack>
  );
}
