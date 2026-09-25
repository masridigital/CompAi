import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import { MspStaffSection } from './MspStaffSection';

const staff = [
  {
    id: 'mem_1',
    role: 'msp_tech',
    createdAt: '2026-01-01T00:00:00Z',
    user: { id: 'usr_1', name: 'Tina Tech', email: 'tina@msp.com', role: 'msp_staff' },
  },
];

const candidates = [
  { id: 'usr_1', name: 'Tina Tech', email: 'tina@msp.com', role: 'msp_staff' },
  { id: 'usr_2', name: 'Sam Support', email: 'sam@msp.com', role: 'msp_staff' },
];

function renderSection() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MspStaffSection orgId="org_1" orgName="Acme Corp" />
    </SWRConfig>,
  );
}

describe('MspStaffSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation((url: string) => {
      if (url.startsWith('/v1/admin/users/msp-staff')) {
        return Promise.resolve({ data: { data: candidates, count: 2 } });
      }
      return Promise.resolve({ data: { data: staff, count: 1 } });
    });
    mockPost.mockResolvedValue({ data: { data: [], count: 1 } });
    mockDelete.mockResolvedValue({ data: { success: true } });
  });

  it('lists assigned MSP staff', async () => {
    renderSection();
    expect(await screen.findByText('tina@msp.com')).toBeInTheDocument();
    expect(screen.getByText('MSP staff (1)')).toBeInTheDocument();
    expect(screen.getByText('msp_tech')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/v1/admin/organizations/org_1/msp-staff');
  });

  it('shows an empty state when nobody is assigned', async () => {
    mockGet.mockResolvedValue({ data: { data: [], count: 0 } });
    renderSection();
    expect(await screen.findByText('No MSP staff assigned.')).toBeInTheDocument();
  });

  it('removes a staff member via DELETE', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove tina@msp.com' }));
    await waitFor(() =>
      expect(mockDelete).toHaveBeenCalledWith('/v1/admin/organizations/org_1/msp-staff/usr_1'),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('MSP staff member removed'));
  });

  it('adds an unassigned candidate via POST and hides already-assigned users', async () => {
    renderSection();
    await screen.findByText('tina@msp.com');
    fireEvent.click(screen.getByRole('button', { name: 'Add MSP staff' }));

    const addSam = await screen.findByRole('button', { name: 'Add sam@msp.com' });
    expect(screen.queryByRole('button', { name: 'Add tina@msp.com' })).not.toBeInTheDocument();

    fireEvent.click(addSam);
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/v1/admin/organizations/org_1/msp-staff', {
        userIds: ['usr_2'],
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('MSP staff member added'));
  });

  it('surfaces API errors on add', async () => {
    mockPost.mockResolvedValue({ error: 'Only users with global role msp_staff or admin' });
    renderSection();
    await screen.findByText('tina@msp.com');
    fireEvent.click(screen.getByRole('button', { name: 'Add MSP staff' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add sam@msp.com' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Only users with global role msp_staff or admin'),
    );
  });
});
