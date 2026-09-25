'use client';

import { isMspStaffRole, MSP_PANE_PATH } from '@/lib/msp-access';
import type { OrganizationFromMe } from '@/types';
import { authClient } from '@/utils/auth-client';
import { Button, OrganizationSelector } from '@trycompai/design-system';
import { Add, Enterprise } from '@trycompai/design-system/icons';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface OrganizationSwitcherProps {
  organizations: OrganizationFromMe[];
  organization: { id: string; name: string } | null;
  isCollapsed?: boolean;
  logoUrls?: Record<string, string>;
  modal?: boolean;
}

const DOT_COLORS = [
  '#0ea5e9', // sky-500
  '#3b82f6', // blue-500
  '#6366f1', // indigo-500
  '#a855f7', // purple-500
  '#d946ef', // fuchsia-500
  '#ec4899', // pink-500
  '#f43f5e', // rose-500
  '#ef4444', // red-500
  '#f97316', // orange-500
  '#f59e0b', // amber-500
  '#eab308', // yellow-500
  '#84cc16', // lime-500
  '#22c55e', // green-500
  '#10b981', // emerald-500
  '#14b8a6', // teal-500
  '#06b6d4', // cyan-500
];

function getOrgColor(name: string | null | undefined): string {
  if (!name) return DOT_COLORS[0];
  const charCodeSum = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return DOT_COLORS[charCodeSum % DOT_COLORS.length] || DOT_COLORS[0];
}

export function OrganizationSwitcher({
  organizations,
  organization,
  logoUrls = {},
  modal = true,
}: OrganizationSwitcherProps) {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const showAllClients = isMspStaffRole(session?.user?.role);

  const [isSwitching, setIsSwitching] = useState(false);

  const handleOrgChange = async (orgId: string) => {
    if (orgId !== organization?.id) {
      setIsSwitching(true);
      try {
        await authClient.organization.setActive({ organizationId: orgId });
        router.push(`/${orgId}/`);
      } catch {
        setIsSwitching(false);
      }
    }
  };

  const handleCreateOrganization = () => {
    router.push('/setup?intent=create-additional');
  };

  // Transform organizations to DS OrganizationSelector format
  // logoUrls is fetched server-side and passed as prop
  const selectorOrgs = organizations.map((org) => ({
    id: org.id,
    name: org.name,
    color: getOrgColor(org.name),
    logoUrl: logoUrls[org.id],
    createdAt: org.createdAt,
  }));

  const isExecuting = isSwitching;

  const handleOpenAllClients = () => {
    router.push(MSP_PANE_PATH);
  };

  // MSP staff / platform admins get an "All clients" entry (the master pane)
  // above the create action. Everyone else keeps the default footer.
  const mspFooter = showAllClients ? (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="ghost"
        iconLeft={<Enterprise size={16} />}
        onClick={handleOpenAllClients}
      >
        All clients
      </Button>
      <Button
        size="sm"
        variant="ghost"
        iconLeft={<Add size={16} />}
        disabled={isExecuting}
        onClick={handleCreateOrganization}
      >
        Create organization
      </Button>
    </div>
  ) : undefined;

  return (
    <OrganizationSelector
      organizations={selectorOrgs}
      value={organization?.id}
      onValueChange={handleOrgChange}
      createLabel="Create organization"
      onCreate={handleCreateOrganization}
      footer={mspFooter}
      loading={isExecuting}
      modal={modal}
      placeholder="Select organization"
      hotkey="o"
    />
  );
}
