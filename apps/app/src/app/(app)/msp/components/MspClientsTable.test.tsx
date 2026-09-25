import type { MspClient, MspPosture } from '@/hooks/use-msp-overview';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const mockPush = vi.fn((href: string) => {
  calls.push(`push:${href}`);
});
const mockSetActive = vi.fn(async ({ organizationId }: { organizationId: string }) => {
  calls.push(`setActive:${organizationId}`);
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/utils/auth-client', () => ({
  authClient: {
    organization: {
      setActive: (args: { organizationId: string }) => mockSetActive(args),
    },
  },
}));

import { MspClientsTable } from './MspClientsTable';

function posture(overrides: Partial<MspPosture> = {}): MspPosture {
  return {
    capturedAt: '2026-09-25T00:00:00.000Z',
    overallScore: 70,
    frameworkScores: [],
    controlsPassing: 7,
    controlsTotal: 10,
    failingChecks: 1,
    integrationErrors: 0,
    overdueTasks: 2,
    evidenceExpiring30d: 3,
    openFindings: 4,
    policiesUnpublished: 0,
    lastActivityAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  };
}

function client(name: string, p: MspPosture | null, extra: Partial<MspClient> = {}): MspClient {
  return {
    organizationId: `org_${name.toLowerCase()}`,
    name,
    logo: null,
    posture: p,
    haloClient: null,
    openHaloTickets: 0,
    lastActivityAt: p?.lastActivityAt ?? null,
    ...extra,
  };
}

const CLIENTS = [
  client('Bravo', posture({ overallScore: 90, failingChecks: 0 })),
  client('Alpha', posture({ overallScore: 40, failingChecks: 5 }), {
    haloClient: {
      id: 7,
      name: 'Alpha Halo',
      url: 'https://portal.masri.tech/customers?clientid=7',
    },
    openHaloTickets: 3,
  }),
  client('Charlie', null),
];

function rowNames(): string[] {
  const table = screen.getByTestId('msp-clients-table');
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent ?? '');
}

describe('MspClientsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
  });

  it('renders every client sorted by name with posture and Halo columns', () => {
    render(<MspClientsTable clients={CLIENTS} />);
    expect(rowNames()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    for (const header of ['Client', 'Score', 'Failing checks', 'Halo client', 'Halo tickets']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Alpha Halo' })).toHaveAttribute(
      'href',
      'https://portal.masri.tech/customers?clientid=7',
    );
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('filters by the search box (name or Halo client name)', () => {
    render(<MspClientsTable clients={CLIENTS} />);
    const search = screen.getByPlaceholderText('Search clients...');
    fireEvent.change(search, { target: { value: 'brav' } });
    expect(rowNames()).toEqual(['Bravo']);
    fireEvent.change(search, { target: { value: 'alpha halo' } });
    expect(rowNames()).toEqual(['Alpha']);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No clients match.')).toBeInTheDocument();
  });

  it('sorts by a column; rows without data stay last', () => {
    render(<MspClientsTable clients={CLIENTS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Failing checks' }));
    expect(rowNames()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(screen.getByRole('columnheader', { name: 'Failing checks' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Score' }));
    expect(rowNames()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    fireEvent.click(screen.getByRole('button', { name: 'Score' }));
    expect(rowNames()).toEqual(['Bravo', 'Alpha', 'Charlie']);
  });

  it('Open switches the active tenant first, then navigates to it', async () => {
    render(<MspClientsTable clients={CLIENTS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Bravo' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/org_bravo'));
    expect(mockSetActive).toHaveBeenCalledWith({ organizationId: 'org_bravo' });
    expect(calls).toEqual(['setActive:org_bravo', 'push:/org_bravo']);
  });

  it('does not navigate when switching tenant fails', async () => {
    mockSetActive.mockRejectedValueOnce(new Error('not a member'));
    render(<MspClientsTable clients={CLIENTS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Alpha' }));
    await waitFor(() => expect(mockSetActive).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('hides secondary columns below lg via the wrapper class contract', () => {
    render(<MspClientsTable clients={CLIENTS} />);
    const wrapper = screen.getByTestId('msp-clients-table');
    expect(wrapper.className).toContain('[&_[data-col=lg]]:hidden');
    expect(screen.getByRole('columnheader', { name: 'Halo client' })).toHaveAttribute(
      'data-col',
      'lg',
    );
  });
});
