'use client';

import {
  Badge,
  Button,
  Section,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@trycompai/design-system';
import { Add, TrashCan } from '@trycompai/design-system/icons';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  addMspStaff,
  removeMspStaff,
  useAdminMspStaff,
  type MspStaffMember,
} from '../hooks/use-admin-msp-staff';
import { AddMspStaffSheet } from './AddMspStaffSheet';

export function MspStaffSection({ orgId, orgName }: { orgId: string; orgName: string }) {
  const { staff, isLoading, error, mutate } = useAdminMspStaff(orgId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addingUserId, setAddingUserId] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);

  const handleAdd = async (userId: string) => {
    setAddingUserId(userId);
    try {
      await addMspStaff({ orgId, userIds: [userId] });
      await mutate();
      toast.success('MSP staff member added');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add MSP staff');
    } finally {
      setAddingUserId(null);
    }
  };

  const handleRemove = async (member: MspStaffMember) => {
    setRemovingUserId(member.user.id);
    try {
      await removeMspStaff({ orgId, userId: member.user.id });
      await mutate(
        (current) =>
          Array.isArray(current) ? current.filter((m) => m.id !== member.id) : current,
        { revalidate: true },
      );
      toast.success('MSP staff member removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove MSP staff');
    } finally {
      setRemovingUserId(null);
    }
  };

  return (
    <>
      <Section
        title={`MSP staff (${staff.length})`}
        actions={
          <Button size="sm" iconLeft={<Add size={16} />} onClick={() => setSheetOpen(true)}>
            Add MSP staff
          </Button>
        }
      >
        {error ? (
          <Text size="sm" variant="destructive">
            Failed to load MSP staff.
          </Text>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            Loading MSP staff...
          </div>
        ) : staff.length === 0 ? (
          <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            No MSP staff assigned.
          </div>
        ) : (
          <Table variant="bordered">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Org role</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="max-w-[200px] truncate">
                      <Text size="sm" weight="medium">
                        {member.user.name}
                      </Text>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[250px] truncate">
                      <Text size="sm" variant="muted">
                        {member.user.email}
                      </Text>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{member.role}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="destructive"
                      iconLeft={<TrashCan size={16} />}
                      loading={removingUserId === member.user.id}
                      disabled={removingUserId !== null}
                      onClick={() => handleRemove(member)}
                      aria-label={`Remove ${member.user.email}`}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <AddMspStaffSheet
        open={sheetOpen}
        orgName={orgName}
        assignedUserIds={new Set(staff.map((m) => m.user.id))}
        addingUserId={addingUserId}
        onOpenChange={setSheetOpen}
        onAdd={handleAdd}
      />
    </>
  );
}
