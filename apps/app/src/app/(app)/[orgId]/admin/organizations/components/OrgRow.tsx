'use client';

import { Badge, Button, TableCell, TableRow, Text } from '@trycompai/design-system';
import { View } from '@trycompai/design-system/icons';
import { useRouter } from 'next/navigation';
import type { AdminOrg } from './admin-org-types';
import { PostureCount, PostureScore } from './PostureCells';

export function OrgRow({ org, orgId }: { org: AdminOrg; orgId: string }) {
  const router = useRouter();
  const detailHref = `/${orgId}/admin/organizations/${org.id}`;
  const posture = org.posture ?? null;

  return (
    <TableRow>
      <TableCell>
        <div className="max-w-[300px]">
          <div className="truncate">
            <Text size="sm" weight="medium">
              {org.name}
            </Text>
          </div>
          <div className="truncate">
            <Text size="xs" variant="muted">
              {org.id}
            </Text>
          </div>
        </div>
      </TableCell>
      <TableCell data-col="lg">
        {org.owner ? (
          <div className="max-w-[250px]">
            <div className="truncate">
              <Text size="sm">{org.owner.name}</Text>
            </div>
            <div className="truncate">
              <Text size="xs" variant="muted">
                {org.owner.email}
              </Text>
            </div>
          </div>
        ) : (
          <Text size="xs" variant="muted">
            No owner
          </Text>
        )}
      </TableCell>
      <TableCell>
        <PostureScore posture={posture} />
      </TableCell>
      <TableCell>
        <PostureCount posture={posture} label="Failing checks" value={(p) => p.failingChecks} />
      </TableCell>
      <TableCell data-col="md">
        <PostureCount posture={posture} label="Overdue tasks" value={(p) => p.overdueTasks} />
      </TableCell>
      <TableCell data-col="md">
        <PostureCount posture={posture} label="Open findings" value={(p) => p.openFindings} />
      </TableCell>
      <TableCell data-col="lg">
        <PostureCount
          posture={posture}
          label="Evidence expiring"
          value={(p) => p.evidenceExpiring30d}
        />
      </TableCell>
      <TableCell data-col="xl">
        <Text size="sm" variant="muted">
          {org.memberCount}
        </Text>
      </TableCell>
      <TableCell data-col="xl">
        <Text size="sm" variant="muted">
          {new Date(org.createdAt).toLocaleDateString()}
        </Text>
      </TableCell>
      <TableCell data-col="md">
        <Badge variant={org.hasAccess ? 'default' : 'destructive'}>
          {org.hasAccess ? 'Active' : 'Inactive'}
        </Badge>
      </TableCell>
      <TableCell>
        <Button
          size="sm"
          variant="outline"
          iconLeft={<View size={16} />}
          onClick={() => router.push(detailHref)}
        >
          View
        </Button>
      </TableCell>
    </TableRow>
  );
}
