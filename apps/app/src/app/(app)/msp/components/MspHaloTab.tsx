'use client';

import { useMspHaloTickets } from '@/hooks/use-msp-lists';
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

/** Deep link for the CompAI entity a Halo ticket was raised for. */
export function haloEntityHref({ orgId, entityType }: { orgId: string; entityType: string }) {
  if (entityType === 'finding') return mspLinks.findings(orgId);
  if (entityType === 'check') return mspLinks.integrations(orgId);
  return mspLinks.client(orgId);
}

export function MspHaloTab() {
  const { rows, hasMore, loadMore, isLoading, error } = useMspHaloTickets();
  const { switchTo, pendingKey } = useMspTenantSwitch();

  if (error) return <EmptyState text="Could not load Halo tickets." />;
  if (isLoading) return <EmptyState text="Loading Halo tickets..." />;
  if (rows.length === 0) return <EmptyState text="No open Halo tickets." />;

  return (
    <Stack gap="md">
      <div className={MSP_COLUMN_CLASSES}>
        <Table variant="bordered">
          <TableHeader>
            <TableRow>
              <TableHead>Ticket</TableHead>
              <TableHead data-col="md">Client</TableHead>
              <TableHead data-col="lg">Raised for</TableHead>
              <TableHead data-col="lg">Last event</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const ticketLabel = row.haloTicketId ? `#${row.haloTicketId}` : 'Pending';
              return (
                <TableRow key={row.linkId}>
                  <TableCell>
                    <div className="max-w-[180px] sm:max-w-[280px]">
                      <div className="truncate">
                        {row.url ? (
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {ticketLabel}
                          </a>
                        ) : (
                          <Text size="sm" weight="medium">
                            {ticketLabel}
                          </Text>
                        )}
                      </div>
                      <div className="truncate">
                        <Text size="xs" variant="muted">
                          {row.refToken}
                          <span className="md:hidden"> · {row.orgName}</span>
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
                    <Badge variant="outline">{row.entityType}</Badge>
                  </TableCell>
                  <TableCell data-col="lg">
                    <Text size="sm" variant="muted">
                      {formatDate(row.lastEventAt)}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <OpenButton
                      label={`Open ${row.orgName}`}
                      loading={pendingKey === row.linkId}
                      onClick={() =>
                        switchTo({
                          organizationId: row.organizationId,
                          href: haloEntityHref({
                            orgId: row.organizationId,
                            entityType: row.entityType,
                          }),
                          key: row.linkId,
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
      <LoadMore hasMore={hasMore} onClick={loadMore} />
    </Stack>
  );
}
