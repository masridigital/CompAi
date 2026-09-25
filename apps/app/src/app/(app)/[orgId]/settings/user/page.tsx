import { serverApi } from '@/lib/api-server';
import type { Metadata } from 'next';
import { EmailNotificationPreferences } from './components/EmailNotificationPreferences';
import { LoginEmailSettings } from './components/LoginEmailSettings';
import { McpOrganizationSelector } from './components/McpOrganizationSelector';
import { TwoFactorSettings } from './components/TwoFactorSettings';
import type { McpOrganizationData } from './hooks/useMcpOrganization';

export default async function UserSettings({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const [emailRes, mcpRes, meRes] = await Promise.all([
    serverApi.get<{
      email: string;
      preferences: {
        policyNotifications: boolean;
        taskReminders: boolean;
        weeklyTaskDigest: boolean;
        unassignedItemsNotifications: boolean;
        taskMentions: boolean;
        taskAssignments: boolean;
      };
      isAdminOrOwner: boolean;
      roleNotifications: {
        policyNotifications: boolean;
        taskReminders: boolean;
        taskAssignments: boolean;
        taskMentions: boolean;
        weeklyTaskDigest: boolean;
        findingNotifications: boolean;
      } | null;
    }>('/v1/people/me/email-preferences'),
    serverApi.get<McpOrganizationData>('/v1/mcp/organization'),
    serverApi.get<{ mfa?: { enabled: boolean } }>('/v1/auth/me'),
  ]);

  if (!emailRes.data?.email) {
    return null;
  }

  return (
    <div className="space-y-6">
      <LoginEmailSettings currentEmail={emailRes.data.email} />
      <TwoFactorSettings enabled={meRes.data?.mfa?.enabled === true} />
      <EmailNotificationPreferences
        initialPreferences={emailRes.data.preferences}
        email={emailRes.data.email}
        isAdminOrOwner={emailRes.data.isAdminOrOwner}
        roleNotifications={emailRes.data.roleNotifications}
      />
      {mcpRes.data ? (
        <McpOrganizationSelector initialData={mcpRes.data} />
      ) : null}
    </div>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'User Settings',
  };
}
