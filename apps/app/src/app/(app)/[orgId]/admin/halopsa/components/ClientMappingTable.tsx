'use client';

import {
  createOrgFromHaloClient,
  useHaloClients,
  type HaloClientRow,
} from '@/hooks/use-admin-halopsa';
import {
  Badge,
  Button,
  Input,
  Section,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@trycompai/design-system';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BindClientSheet } from './BindClientSheet';

type Filter = 'unmapped' | 'all';

export function ClientMappingTable({ onChanged }: { onChanged?: () => void }) {
  const { clients, unmappedOrganizations, error, isLoading, mutate } = useHaloClients();
  const [filter, setFilter] = useState<Filter>('unmapped');
  const [search, setSearch] = useState('');
  const [binding, setBinding] = useState<HaloClientRow | null>(null);
  const [creatingId, setCreatingId] = useState<number | null>(null);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return clients.filter((client) => {
      if (filter === 'unmapped' && client.mapping) return false;
      return !query || client.name.toLowerCase().includes(query);
    });
  }, [clients, filter, search]);

  const unmappedCount = clients.filter((c) => !c.mapping).length;

  const handleChanged = () => {
    void mutate();
    onChanged?.();
  };

  const handleCreateOrg = async (client: HaloClientRow) => {
    setCreatingId(client.id);
    const response = await createOrgFromHaloClient({ haloClientId: client.id });
    setCreatingId(null);
    if (response.error) {
      toast.error(response.error);
      return;
    }
    toast.success(`Created an organization for ${client.name}`);
    handleChanged();
  };

  return (
    <Section title="Client mapping" description="Bind each Halo client to one CompAI organization.">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="w-full md:max-w-xs">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search Halo clients..." />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={filter === 'unmapped' ? 'default' : 'outline'}
            onClick={() => setFilter('unmapped')}
          >
            {`Unmapped (${unmappedCount})`}
          </Button>
          <Button size="sm" variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>
            {`All (${clients.length})`}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
          Could not load Halo clients: {error.message}
        </div>
      )}
      {isLoading && <div className="py-8 text-center text-sm text-muted-foreground">Loading Halo clients...</div>}
      {!isLoading && !error && rows.length === 0 && (
        <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
          {filter === 'unmapped' ? 'Every Halo client is mapped.' : 'No Halo clients found.'}
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <Table variant="bordered">
          <TableHeader>
            <TableRow>
              <TableHead>Halo client</TableHead>
              <TableHead>Mapped organization</TableHead>
              <TableHead>Suggestions</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((client) => (
              <TableRow key={client.id}>
                <TableCell>
                  <div className="min-w-40 max-w-64">
                    <div className="truncate font-medium">{client.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      #{client.id}
                      {client.website ? ` · ${client.website}` : ''}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {client.mapping ? (
                    <Text size="sm">{client.mapping.organizationName}</Text>
                  ) : (
                    <Badge variant="outline">Unmapped</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex max-w-72 flex-wrap gap-1">
                    {client.suggestions.length === 0 && <Text size="xs" variant="muted">None</Text>}
                    {client.suggestions.map((s) => (
                      <Badge key={s.organizationId} variant="secondary">
                        {`${s.organizationName} (${s.reason})`}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    {client.mapping ? (
                      <Text size="xs" variant="muted">
                        Bound
                      </Text>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setBinding(client)}>
                          Bind
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          loading={creatingId === client.id}
                          onClick={() => handleCreateOrg(client)}
                        >
                          Create org
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <BindClientSheet
        client={binding}
        organizations={unmappedOrganizations}
        onClose={() => setBinding(null)}
        onBound={handleChanged}
      />
    </Section>
  );
}
