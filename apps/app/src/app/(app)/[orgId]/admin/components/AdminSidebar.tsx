'use client';

import { MSP_PANE_PATH } from '@/lib/msp-access';
import { AppShellNav, AppShellNavItem } from '@trycompai/design-system';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface AdminSidebarProps {
  orgId: string;
}

export function AdminSidebar({ orgId }: AdminSidebarProps) {
  const pathname = usePathname() ?? '';

  const items = [
    // MSP master pane (outside /[orgId]): every client tenant at once.
    { id: 'msp', label: 'All clients', path: MSP_PANE_PATH },
    { id: 'organizations', label: 'Organizations', path: `/${orgId}/admin/organizations` },
    { id: 'integrations', label: 'Integrations', path: `/${orgId}/admin/integrations` },
    { id: 'halopsa', label: 'HaloPSA', path: `/${orgId}/admin/halopsa` },
    {
      id: 'timeline-templates',
      label: 'Timeline Templates',
      path: `/${orgId}/admin/timeline-templates`,
    },
    {
      id: 'finding-templates',
      label: 'Finding Templates',
      path: `/${orgId}/admin/finding-templates`,
    },
  ];

  const isPathActive = (path: string) => pathname.startsWith(path);

  return (
    <AppShellNav>
      {items.map((item) => (
        <Link key={item.id} href={item.path}>
          <AppShellNavItem isActive={isPathActive(item.path)}>{item.label}</AppShellNavItem>
        </Link>
      ))}
    </AppShellNav>
  );
}
