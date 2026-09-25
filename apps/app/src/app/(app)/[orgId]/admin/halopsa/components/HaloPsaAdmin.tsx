'use client';

import { useHaloConnections } from '@/hooks/use-admin-halopsa';
import { PageHeader, PageLayout, Stack } from '@trycompai/design-system';
import { ClientMappingTable } from './ClientMappingTable';
import { OutboxDeadLetters } from './OutboxDeadLetters';
import { WebhookTokenSection } from './WebhookTokenSection';

export function HaloPsaAdmin() {
  const { mutate: refreshConnections } = useHaloConnections();

  return (
    <PageLayout header={<PageHeader title="HaloPSA" />}>
      <div className="mx-auto w-full max-w-7xl">
        <Stack gap="lg">
          <ClientMappingTable onChanged={() => void refreshConnections()} />
          <WebhookTokenSection />
          <OutboxDeadLetters />
        </Stack>
      </div>
    </PageLayout>
  );
}
