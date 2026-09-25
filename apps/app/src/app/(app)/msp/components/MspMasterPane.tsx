'use client';

import { useMspOverview, type MspOverview } from '@/hooks/use-msp-overview';
import {
  Button,
  PageHeader,
  PageHeaderDescription,
  PageLayout,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from '@trycompai/design-system';
import { Renew } from '@trycompai/design-system/icons';
import { useState } from 'react';
import { MspChecksTab } from './MspChecksTab';
import { MspClientsTable } from './MspClientsTable';
import { MspFindingsTab } from './MspFindingsTab';
import { MspHaloTab } from './MspHaloTab';
import { MspKpiRow } from './MspKpiRow';
import { MspTasksTab } from './MspTasksTab';

type PaneTab = 'clients' | 'tasks' | 'checks' | 'findings' | 'halo';

const TABS: Array<{ id: PaneTab; label: string }> = [
  { id: 'clients', label: 'Clients' },
  { id: 'tasks', label: 'Overdue tasks' },
  { id: 'checks', label: 'Failing checks' },
  { id: 'findings', label: 'Open findings' },
  { id: 'halo', label: 'Halo tickets' },
];

function isPaneTab(value: unknown): value is PaneTab {
  return TABS.some((tab) => tab.id === value);
}

/**
 * MSP master pane: every client tenant the viewer may see, with KPI totals and
 * cross-tenant work queues. Only the active tab mounts, so each queue is
 * fetched on first open.
 */
export function MspMasterPane({ initialOverview }: { initialOverview: MspOverview | null }) {
  const [tab, setTab] = useState<PaneTab>('clients');
  const { totals, clients, error, isValidating, mutate } = useMspOverview({
    fallbackData: initialOverview,
  });

  return (
    <div className="min-h-dvh w-full px-4 py-6 sm:px-6 lg:py-8">
      <PageLayout
        maxWidth="2xl"
        header={
          <PageHeader
            title="All clients"
            backHref="/"
            backLabel="Back to the app"
            actions={
              <Button
                variant="outline"
                onClick={() => mutate()}
                loading={isValidating}
                iconLeft={<Renew size={16} />}
              >
                Refresh
              </Button>
            }
          >
            <PageHeaderDescription>
              Every client tenant you support. Open a row to switch into that tenant.
            </PageHeaderDescription>
          </PageHeader>
        }
      >
        {error ? <Text variant="destructive">Could not refresh the client overview.</Text> : null}
        {totals ? <MspKpiRow totals={totals} /> : null}
        <Tabs
          value={tab}
          onValueChange={(value: unknown) => {
            if (isPaneTab(value)) setTab(value);
          }}
        >
          <TabsList>
            {TABS.map((item) => (
              <TabsTrigger key={item.id} value={item.id}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="pt-4">
            <TabsContent value="clients">
              <MspClientsTable clients={clients} />
            </TabsContent>
            <TabsContent value="tasks">
              <MspTasksTab />
            </TabsContent>
            <TabsContent value="checks">
              <MspChecksTab />
            </TabsContent>
            <TabsContent value="findings">
              <MspFindingsTab />
            </TabsContent>
            <TabsContent value="halo">
              <MspHaloTab />
            </TabsContent>
          </div>
        </Tabs>
      </PageLayout>
    </div>
  );
}
