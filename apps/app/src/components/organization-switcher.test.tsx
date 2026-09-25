import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPush = vi.fn();
let mockRole: string | null = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/utils/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { role: mockRole } } }),
    organization: { setActive: vi.fn() },
  },
}));

// Render the selector's footer inline so the entry is visible without opening it.
vi.mock('@trycompai/design-system', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@trycompai/design-system')>();
  return {
    ...actual,
    OrganizationSelector: ({
      footer,
      createLabel,
    }: {
      footer?: ReactNode;
      createLabel?: string;
    }) => <div data-testid="org-selector">{footer ?? <span>{createLabel} (default)</span>}</div>,
  };
});

import { OrganizationSwitcher } from './organization-switcher';

function renderSwitcher() {
  return render(
    <OrganizationSwitcher organizations={[]} organization={{ id: 'org_1', name: 'Acme' }} />,
  );
}

describe('OrganizationSwitcher "All clients" entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = null;
  });

  it.each(['admin', 'msp_staff', 'user,msp_staff'])('is shown for %s and opens /msp', (role) => {
    mockRole = role;
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: 'All clients' }));
    expect(mockPush).toHaveBeenCalledWith('/msp');
    // The create action stays available next to it.
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeInTheDocument();
  });

  it.each(['user', null])('is hidden for role %s (default footer kept)', (role) => {
    mockRole = role;
    renderSwitcher();
    expect(screen.queryByRole('button', { name: 'All clients' })).not.toBeInTheDocument();
    expect(screen.getByText('Create organization (default)')).toBeInTheDocument();
  });
});
