import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN_PERMISSIONS, AUDITOR_PERMISSIONS } from '@/test-utils/mocks/permissions';
import type { UserPermissions } from '@/lib/permissions';
import { SettingsSidebar } from './SettingsSidebar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/org-1/settings',
}));

vi.mock('@trycompai/design-system', () => ({
  AppShellNav: ({ children }: { children: React.ReactNode }) => <nav>{children}</nav>,
  AppShellNavItem: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

describe('SettingsSidebar', () => {
  it('places Billing directly after General when visible', () => {
    render(<SettingsSidebar orgId="org-1" permissions={ADMIN_PERMISSIONS} showBillingTab={true} showBrowserTab={false} />);

    const links = screen.getAllByRole('link').map((link) => link.textContent);
    expect(links.slice(0, 3)).toEqual(['General', 'Billing', 'Context']);
  });

  it('hides Billing when the billing tab is disabled', () => {
    render(<SettingsSidebar orgId="org-1" permissions={ADMIN_PERMISSIONS} showBillingTab={false} showBrowserTab={false} />);

    expect(screen.queryByRole('link', { name: 'Billing' })).not.toBeInTheDocument();
  });

  it('hides Browser even when the browser tab flag is enabled', () => {
    render(<SettingsSidebar orgId="org-1" permissions={ADMIN_PERMISSIONS} showBillingTab={true} showBrowserTab={true} />);

    expect(screen.queryByRole('link', { name: 'Browser' })).not.toBeInTheDocument();
  });

  it('hides tabs the member cannot use (msp_tech has no apiKey, secret or ac access)', () => {
    const mspTech: UserPermissions = {
      organization: ['read', 'update'],
      evidence: ['read', 'update'],
      member: ['read', 'create', 'update'],
      integration: ['read'],
    };
    render(<SettingsSidebar orgId="org-1" permissions={mspTech} showBillingTab={false} showBrowserTab={false} />);

    const labels = screen.getAllByRole('link').map((link) => link.textContent);
    expect(labels).toEqual(['General', 'Context', 'Portal', 'Notifications', 'User Settings']);
  });

  it('shows every tab to an admin', () => {
    render(<SettingsSidebar orgId="org-1" permissions={ADMIN_PERMISSIONS} showBillingTab={false} showBrowserTab={false} />);

    const labels = screen.getAllByRole('link').map((link) => link.textContent);
    expect(labels).toEqual(['General', 'Context', 'API Keys', 'Portal', 'Secrets', 'Roles', 'Notifications', 'User Settings']);
  });

  it('hides Roles from auditors, whose role cannot read /v1/roles', () => {
    render(<SettingsSidebar orgId="org-1" permissions={AUDITOR_PERMISSIONS} showBillingTab={false} showBrowserTab={false} />);

    expect(screen.queryByRole('link', { name: 'Roles' })).not.toBeInTheDocument();
  });
});
