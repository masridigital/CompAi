import type { MspTotals } from '@/hooks/use-msp-overview';
import { Text } from '@trycompai/design-system';

interface Kpi {
  id: string;
  label: string;
  value: string;
}

export function kpisFromTotals(totals: MspTotals): Kpi[] {
  return [
    { id: 'clients', label: 'Clients', value: String(totals.clients) },
    {
      id: 'avgScore',
      label: 'Avg. score',
      value: totals.avgScore === null ? '—' : `${totals.avgScore}%`,
    },
    { id: 'failingChecks', label: 'Failing checks', value: String(totals.failingChecks) },
    { id: 'overdueTasks', label: 'Overdue tasks', value: String(totals.overdueTasks) },
    { id: 'openFindings', label: 'Open findings', value: String(totals.openFindings) },
    {
      id: 'evidenceExpiring30d',
      label: 'Evidence expiring (30d)',
      value: String(totals.evidenceExpiring30d),
    },
    { id: 'openHaloTickets', label: 'Open Halo tickets', value: String(totals.openHaloTickets) },
  ];
}

/** KPI stat tiles: 2 per row on phones, 4 on tablets, all 7 on desktop. */
export function MspKpiRow({ totals }: { totals: MspTotals }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7" data-testid="msp-kpi-row">
      {kpisFromTotals(totals).map((kpi) => (
        <div
          key={kpi.id}
          className="flex min-w-0 flex-col gap-1 rounded-lg border bg-background p-3"
          data-testid={`msp-kpi-${kpi.id}`}
        >
          <div className="truncate">
            <Text size="xs" variant="muted">
              {kpi.label}
            </Text>
          </div>
          <Text size="lg" weight="semibold">
            {kpi.value}
          </Text>
        </div>
      ))}
    </div>
  );
}
