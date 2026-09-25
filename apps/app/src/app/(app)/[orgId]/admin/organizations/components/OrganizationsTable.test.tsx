import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminOrg, ClientPosture } from './admin-org-types';

const mockReplace = vi.fn();
const mockPush = vi.fn();
let mockSearch = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  usePathname: () => '/org_admin/admin/organizations',
  useSearchParams: () => mockSearch,
}));

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn().mockResolvedValue({ data: { data: [], total: 0 } }) },
}));

import { OrganizationsTable } from './OrganizationsTable';

const posture = (overrides: Partial<ClientPosture> = {}): ClientPosture => ({
  capturedAt: '2026-09-25T05:30:00.000Z',
  frameworkScores: [{ frameworkId: 'frk_1', name: 'SOC 2', score: 42 }],
  overallScore: 42,
  controlsPassing: 3,
  controlsTotal: 10,
  failingChecks: 7,
  overdueTasks: 2,
  openFindings: 4,
  evidenceExpiring30d: 5,
  policiesUnpublished: 1,
  integrationErrors: 0,
  lastActivityAt: null,
  ...overrides,
});

const org = (name: string, p: ClientPosture | null): AdminOrg => ({
  id: `org_${name.toLowerCase()}`,
  name,
  slug: name.toLowerCase(),
  logo: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  hasAccess: true,
  onboardingCompleted: true,
  memberCount: 3,
  owner: { id: 'usr_1', name: 'Owner', email: 'owner@example.com' },
  posture: p,
});

function renderTable(orgs: AdminOrg[]) {
  return render(
    <OrganizationsTable
      initialOrgs={orgs}
      initialTotal={orgs.length}
      initialPage={1}
      initialSearch=""
      orgId="org_admin"
    />,
  );
}

function rowNames(): string[] {
  const rows = screen.getAllByRole('row').slice(1);
  return rows.map((row) => within(row).getAllByRole('cell')[0].textContent ?? '');
}

describe('OrganizationsTable posture columns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch = new URLSearchParams();
  });

  it('renders posture headers and values', () => {
    renderTable([org('Acme', posture())]);

    for (const header of [
      'Score',
      'Failing checks',
      'Overdue tasks',
      'Open findings',
      'Expiring (30d)',
    ]) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByLabelText('Failing checks: 7')).toBeInTheDocument();
    expect(screen.getByLabelText('Overdue tasks: 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Open findings: 4')).toBeInTheDocument();
    expect(screen.getByLabelText('Evidence expiring: 5')).toBeInTheDocument();
  });

  it('shows a placeholder when an org has no snapshot yet', () => {
    renderTable([org('Newco', null)]);
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('hides secondary columns on small screens via breakpoint classes', () => {
    renderTable([org('Acme', posture())]);

    const wrapper = screen.getByTestId('organizations-table');
    expect(wrapper.className).toContain('[&_[data-col=md]]:hidden');
    expect(wrapper.className).toContain('md:[&_[data-col=md]]:table-cell');
    expect(wrapper.className).toContain('lg:[&_[data-col=lg]]:table-cell');
    expect(screen.getByRole('columnheader', { name: 'Overdue tasks' })).toHaveAttribute(
      'data-col',
      'md',
    );
    expect(screen.getByRole('columnheader', { name: 'Expiring (30d)' })).toHaveAttribute(
      'data-col',
      'lg',
    );
    // Primary posture columns are always visible.
    expect(screen.getByRole('columnheader', { name: 'Score' })).not.toHaveAttribute('data-col');
    expect(screen.getByRole('columnheader', { name: 'Failing checks' })).not.toHaveAttribute(
      'data-col',
    );
  });

  it('sorts by name by default', () => {
    renderTable([org('Zeta', posture({ overallScore: 10 })), org('Acme', posture())]);
    expect(rowNames()[0]).toContain('Acme');
  });

  it('sorts by lowest score when ?sort=score', () => {
    mockSearch = new URLSearchParams('sort=score');
    renderTable([
      org('Acme', posture({ overallScore: 90 })),
      org('Zeta', posture({ overallScore: 10 })),
      org('Newco', null),
    ]);
    const names = rowNames();
    expect(names[0]).toContain('Zeta');
    expect(names[1]).toContain('Acme');
    expect(names[2]).toContain('Newco');
  });
});
