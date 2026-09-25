'use client';

import {
  Badge,
  Button,
  Input,
  Label,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Stack,
  Text,
} from '@trycompai/design-system';
import { Add } from '@trycompai/design-system/icons';
import { useState } from 'react';
import { useMspStaffCandidates } from '../hooks/use-admin-msp-staff';

export function AddMspStaffSheet({
  open,
  orgName,
  assignedUserIds,
  addingUserId,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  orgName: string;
  assignedUserIds: Set<string>;
  addingUserId: string | null;
  onOpenChange: (open: boolean) => void;
  onAdd: (userId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const { candidates, isLoading, error } = useMspStaffCandidates({ search, enabled: open });
  const available = candidates.filter((c) => !assignedUserIds.has(c.id));

  const handleOpenChange = (next: boolean) => {
    if (!next) setSearch('');
    onOpenChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add MSP staff to {orgName}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <Stack gap="md">
            <Text size="sm" variant="muted">
              Only users with the global role msp_staff or admin are listed. They join with
              the msp_tech role and receive no invite email.
            </Text>
            <div className="flex flex-col gap-2">
              <Label htmlFor="msp-staff-search">Search</Label>
              <Input
                id="msp-staff-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or email"
              />
            </div>
            {error ? (
              <Text size="sm" variant="destructive">
                Failed to load MSP staff users.
              </Text>
            ) : isLoading ? (
              <Text size="sm" variant="muted">
                Loading users...
              </Text>
            ) : available.length === 0 ? (
              <div className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
                No unassigned MSP staff users found.
              </div>
            ) : (
              <ul className="flex flex-col divide-y rounded-lg border">
                {available.map((candidate) => (
                  <li
                    key={candidate.id}
                    className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="truncate">
                        <Text size="sm" weight="medium">
                          {candidate.name}
                        </Text>
                      </div>
                      <div className="truncate">
                        <Text size="xs" variant="muted">
                          {candidate.email}
                        </Text>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline">{candidate.role ?? 'user'}</Badge>
                      <Button
                        size="sm"
                        iconLeft={<Add size={16} />}
                        loading={addingUserId === candidate.id}
                        disabled={addingUserId !== null}
                        onClick={() => onAdd(candidate.id)}
                        aria-label={`Add ${candidate.email}`}
                      >
                        Add
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Stack>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
