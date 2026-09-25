import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('@/lib/api-client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ClientMappingTable } from './ClientMappingTable';
import { HaloPsaAdmin } from './HaloPsaAdmin';
import { OutboxDeadLetters } from './OutboxDeadLetters';
import { WebhookTokenSection } from './WebhookTokenSection';

const clientsResponse = {
  clients: [
    {
      id: 10,
      name: 'Alpha Ltd',
      website: 'alpha.com',
      mapping: { organizationId: 'org_a', organizationName: 'Alpha', connectionId: 'icn_a' },
      suggestions: [],
    },
    {
      id: 11,
      name: 'Beta',
      website: 'beta.io',
      mapping: null,
      suggestions: [{ organizationId: 'org_b', organizationName: 'Beta LLC', reason: 'domain' }],
    },
  ],
  unmappedOrganizations: [{ id: 'org_b', name: 'Beta LLC', website: 'https://beta.io' }],
  connections: [],
};

const deadEvents = [
  {
    id: 'hob_1',
    organizationId: 'org_a',
    organization: { id: 'org_a', name: 'Alpha' },
    linkId: 'htl_1',
    kind: 'create_ticket',
    status: 'dead',
    attempts: 8,
    lastError: 'HaloPSA API /Tickets failed with HTTP 400',
    createdAt: '2026-09-25T10:00:00Z',
    nextAttemptAt: '2026-09-25T10:00:00Z',
  },
];

function routeGet(url: string) {
  if (url === '/v1/admin/halopsa/clients') return Promise.resolve({ data: clientsResponse });
  if (url === '/v1/admin/halopsa/connections') {
    return Promise.resolve({
      data: {
        data: [
          {
            connectionId: 'icn_a',
            organizationId: 'org_a',
            organizationName: 'Alpha',
            status: 'active',
            haloClientId: 10,
            haloSiteId: null,
            hasWebhookToken: false,
          },
        ],
      },
    });
  }
  if (url === '/v1/admin/halopsa/outbox?status=dead') return Promise.resolve({ data: { data: deadEvents } });
  return Promise.resolve({ error: `unexpected ${url}` });
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

describe('HaloPSA admin page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation(routeGet);
    mockPost.mockResolvedValue({ data: {} });
  });

  it('renders the three sections', async () => {
    render(<HaloPsaAdmin />, { wrapper });
    expect(screen.getByText('Client mapping')).toBeInTheDocument();
    expect(screen.getByText('Webhook token')).toBeInTheDocument();
    expect(screen.getByText('Failed deliveries')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Beta')).toBeInTheDocument());
  });

  it('shows unmapped clients by default with suggestions', async () => {
    render(<ClientMappingTable />, { wrapper });
    await waitFor(() => expect(screen.getByText('Beta')).toBeInTheDocument());
    expect(screen.queryByText('Alpha Ltd')).not.toBeInTheDocument();
    expect(screen.getByText('Beta LLC (domain)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /all \(2\)/i }));
    expect(screen.getByText('Alpha Ltd')).toBeInTheDocument();
  });

  it('creates an org from a Halo client', async () => {
    render(<ClientMappingTable />, { wrapper });
    await waitFor(() => expect(screen.getByText('Beta')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /create org/i }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/v1/admin/halopsa/clients/11/create-org', {}),
    );
  });

  it('binds a client to the suggested org', async () => {
    render(<ClientMappingTable />, { wrapper });
    await waitFor(() => expect(screen.getByText('Beta')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^bind$/i }));
    const submit = await screen.findByRole('button', { name: /bind client/i });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/v1/admin/halopsa/clients/11/bind', { organizationId: 'org_b' }),
    );
  });

  it('lists dead outbox events and retries one', async () => {
    render(<OutboxDeadLetters />, { wrapper });
    const row = await screen.findByText('Alpha');
    const tableRow = row.closest('tr');
    expect(tableRow).not.toBeNull();
    expect(within(tableRow as HTMLElement).getByText('create_ticket')).toBeInTheDocument();
    fireEvent.click(within(tableRow as HTMLElement).getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/v1/admin/halopsa/outbox/hob_1/retry', {}));
  });

  it('requires a connection before generating a webhook token', async () => {
    render(<WebhookTokenSection />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /generate token/i }));
    expect(await screen.findByText('Choose a connection')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows an empty state when nothing failed', async () => {
    mockGet.mockImplementation((url: string) =>
      url.includes('outbox') ? Promise.resolve({ data: { data: [] } }) : routeGet(url),
    );
    render(<OutboxDeadLetters />, { wrapper });
    expect(await screen.findByText('No failed deliveries.')).toBeInTheDocument();
  });
});
