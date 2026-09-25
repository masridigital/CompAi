import type { MspClient } from '@/hooks/use-msp-overview';
import { isMspStaffRole } from '@/lib/msp-access';
import { describe, expect, it, vi } from 'vitest';
import { haloEntityHref } from './MspHaloTab';
import { kpisFromTotals } from './MspKpiRow';
import { filterClients, nextSort, sortClients } from './msp-client-sort';

vi.mock('@/utils/auth-client', () => ({ authClient: { organization: { setActive: vi.fn() } } }));

function client(name: string, overdue: number | null): MspClient {
  return {
    organizationId: `org_${name}`,
    name,
    logo: null,
    posture:
      overdue === null
        ? null
        : {
            capturedAt: '2026-09-25T00:00:00.000Z',
            overallScore: null,
            frameworkScores: null,
            controlsPassing: null,
            controlsTotal: null,
            failingChecks: null,
            integrationErrors: null,
            overdueTasks: overdue,
            evidenceExpiring30d: null,
            openFindings: null,
            policiesUnpublished: null,
            lastActivityAt: null,
          },
    haloClient: null,
    openHaloTickets: null,
    lastActivityAt: null,
  };
}

describe('msp client sort/filter', () => {
  const clients = [client('b', 1), client('a', 5), client('c', null)];

  it('sorts numeric columns worst-first by default and keeps nulls last', () => {
    const sort = nextSort({ current: { key: 'name', direction: 'asc' }, key: 'overdueTasks' });
    expect(sort).toEqual({ key: 'overdueTasks', direction: 'desc' });
    expect(sortClients({ clients, sort }).map((c) => c.name)).toEqual(['a', 'b', 'c']);
    const flipped = nextSort({ current: sort, key: 'overdueTasks' });
    expect(sortClients({ clients, sort: flipped }).map((c) => c.name)).toEqual(['b', 'a', 'c']);
  });

  it('filters on name and org id', () => {
    expect(filterClients({ clients, query: 'org_c' }).map((c) => c.name)).toEqual(['c']);
    expect(filterClients({ clients, query: '  ' })).toHaveLength(3);
  });
});

describe('isMspStaffRole', () => {
  it('matches the API rule', () => {
    expect(isMspStaffRole('admin')).toBe(true);
    expect(isMspStaffRole('msp_staff')).toBe(true);
    expect(isMspStaffRole('user, msp_staff')).toBe(true);
    expect(isMspStaffRole('admin,user')).toBe(false);
    expect(isMspStaffRole('user')).toBe(false);
    expect(isMspStaffRole(undefined)).toBe(false);
  });
});

describe('master pane helpers', () => {
  it('formats KPI tiles, with a dash when no score is visible', () => {
    const kpis = kpisFromTotals({
      clients: 3,
      avgScore: null,
      failingChecks: 1,
      overdueTasks: 2,
      openFindings: 3,
      evidenceExpiring30d: 4,
      openHaloTickets: 5,
    });
    expect(kpis.map((k) => k.value)).toEqual(['3', '—', '1', '2', '3', '4', '5']);
  });

  it('deep-links Halo tickets to the entity they were raised for', () => {
    expect(haloEntityHref({ orgId: 'org_1', entityType: 'finding' })).toBe(
      '/org_1/overview/findings',
    );
    expect(haloEntityHref({ orgId: 'org_1', entityType: 'check' })).toBe('/org_1/integrations');
    expect(haloEntityHref({ orgId: 'org_1', entityType: 'digest' })).toBe('/org_1');
  });
});
