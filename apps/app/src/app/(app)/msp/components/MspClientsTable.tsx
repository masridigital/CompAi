'use client';

import type { MspClient } from '@/hooks/use-msp-overview';
import { mspLinks, useMspTenantSwitch } from '@/hooks/use-msp-tenant-switch';
import {
  Button,
  DataTableHeader,
  DataTableSearch,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@trycompai/design-system';
import { ArrowDown, ArrowUp } from '@trycompai/design-system/icons';
import { useMemo, useState } from 'react';
import {
  CountCell,
  EmptyState,
  formatDate,
  MSP_COLUMN_CLASSES,
  OpenButton,
  ScoreCell,
} from './msp-cells';
import {
  filterClients,
  nextSort,
  sortClients,
  type MspClientSort,
  type MspClientSortKey,
} from './msp-client-sort';

interface Column {
  key: MspClientSortKey;
  label: string;
  col?: 'md' | 'lg' | 'xl';
}

const COLUMNS: Column[] = [
  { key: 'name', label: 'Client' },
  { key: 'score', label: 'Score' },
  { key: 'failingChecks', label: 'Failing checks' },
  { key: 'overdueTasks', label: 'Overdue', col: 'md' },
  { key: 'openFindings', label: 'Open findings', col: 'md' },
  { key: 'evidenceExpiring30d', label: 'Evidence expiring', col: 'lg' },
  { key: 'openHaloTickets', label: 'Halo tickets', col: 'lg' },
  { key: 'lastActivityAt', label: 'Last activity', col: 'xl' },
];

function SortHeader({
  column,
  sort,
  onSort,
}: {
  column: Column;
  sort: MspClientSort;
  onSort: (key: MspClientSortKey) => void;
}) {
  const active = sort.key === column.key;
  const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  const icon = active ? (
    sort.direction === 'asc' ? (
      <ArrowUp size={12} />
    ) : (
      <ArrowDown size={12} />
    )
  ) : undefined;
  return (
    <TableHead data-col={column.col} aria-sort={ariaSort}>
      <Button size="sm" variant="ghost" iconRight={icon} onClick={() => onSort(column.key)}>
        {column.label}
      </Button>
    </TableHead>
  );
}

function HaloClientCell({ client }: { client: MspClient }) {
  if (!client.haloClient) {
    return (
      <Text size="xs" variant="muted">
        —
      </Text>
    );
  }
  const label = client.haloClient.name ?? `#${client.haloClient.id}`;
  if (!client.haloClient.url) return <Text size="sm">{label}</Text>;
  return (
    <a
      href={client.haloClient.url}
      target="_blank"
      rel="noreferrer"
      className="block max-w-[200px] truncate text-sm text-primary underline-offset-4 hover:underline"
    >
      {label}
    </a>
  );
}

export function MspClientsTable({ clients }: { clients: MspClient[] }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<MspClientSort>({ key: 'name', direction: 'asc' });
  const { switchTo, pendingKey } = useMspTenantSwitch();

  const rows = useMemo(
    () => sortClients({ clients: filterClients({ clients, query }), sort }),
    [clients, query, sort],
  );

  const handleSort = (key: MspClientSortKey) => setSort((current) => nextSort({ current, key }));

  return (
    <Stack gap="md">
      <DataTableHeader>
        <DataTableSearch
          placeholder="Search clients..."
          value={query}
          onChange={(value: string) => setQuery(value)}
        />
      </DataTableHeader>

      {rows.length === 0 ? (
        <EmptyState text={clients.length === 0 ? 'No client tenants yet.' : 'No clients match.'} />
      ) : (
        <div className={MSP_COLUMN_CLASSES} data-testid="msp-clients-table">
          <Table variant="bordered">
            <TableHeader>
              <TableRow>
                {COLUMNS.slice(0, 6).map((column) => (
                  <SortHeader key={column.key} column={column} sort={sort} onSort={handleSort} />
                ))}
                <TableHead data-col="lg">Halo client</TableHead>
                {COLUMNS.slice(6).map((column) => (
                  <SortHeader key={column.key} column={column} sort={sort} onSort={handleSort} />
                ))}
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((client) => (
                <TableRow key={client.organizationId}>
                  <TableCell>
                    <div className="max-w-[160px] truncate sm:max-w-[260px]">
                      <Text size="sm" weight="medium">
                        {client.name}
                      </Text>
                    </div>
                  </TableCell>
                  <TableCell>
                    <ScoreCell score={client.posture?.overallScore} />
                  </TableCell>
                  <TableCell>
                    <CountCell value={client.posture?.failingChecks} />
                  </TableCell>
                  <TableCell data-col="md">
                    <CountCell value={client.posture?.overdueTasks} />
                  </TableCell>
                  <TableCell data-col="md">
                    <CountCell value={client.posture?.openFindings} />
                  </TableCell>
                  <TableCell data-col="lg">
                    <CountCell value={client.posture?.evidenceExpiring30d} />
                  </TableCell>
                  <TableCell data-col="lg">
                    <HaloClientCell client={client} />
                  </TableCell>
                  <TableCell data-col="lg">
                    <CountCell value={client.openHaloTickets} />
                  </TableCell>
                  <TableCell data-col="xl">
                    <Text size="sm" variant="muted">
                      {formatDate(client.lastActivityAt)}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <OpenButton
                      label={`Open ${client.name}`}
                      loading={pendingKey === client.organizationId}
                      onClick={() =>
                        switchTo({
                          organizationId: client.organizationId,
                          href: mspLinks.client(client.organizationId),
                          key: client.organizationId,
                        })
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Stack>
  );
}
