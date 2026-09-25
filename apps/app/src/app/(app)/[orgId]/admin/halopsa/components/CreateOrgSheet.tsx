'use client';

import { createOrgFromHaloClient, type HaloClientRow } from '@/hooks/use-admin-halopsa';
import { zodResolver } from '@hookform/resolvers/zod';
import {
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
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

const createOrgSchema = z.object({
  ownerEmail: z
    .string()
    .trim()
    .max(320)
    .refine((value) => value === '' || z.string().email().safeParse(value).success, 'Enter a valid email')
    .optional(),
});

type CreateOrgFormValues = z.infer<typeof createOrgSchema>;

interface CreateOrgSheetProps {
  client: HaloClientRow | null;
  onClose: () => void;
  onCreated: () => void;
}

/** Create an organization from a Halo client; the client's owner is invited by email. */
export function CreateOrgSheet({ client, onClose, onCreated }: CreateOrgSheetProps) {
  const [saving, setSaving] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateOrgFormValues>({
    resolver: zodResolver(createOrgSchema),
    defaultValues: { ownerEmail: '' },
  });

  useEffect(() => {
    if (client) reset({ ownerEmail: '' });
  }, [client, reset]);

  const handleCreate = async (values: CreateOrgFormValues) => {
    if (!client) return;
    setSaving(true);
    const response = await createOrgFromHaloClient({
      haloClientId: client.id,
      ownerEmail: values.ownerEmail || undefined,
    });
    setSaving(false);
    if (response.error) {
      toast.error(response.error);
      return;
    }
    toast.success(`Created an organization for ${client.name}`);
    onCreated();
    onClose();
  };

  return (
    <Sheet open={client !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Create organization for {client?.name ?? 'Halo client'}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <form noValidate onSubmit={handleSubmit(handleCreate)}>
            <Stack gap="md">
              <Text size="sm" variant="muted">
                You join the new organization as an admin. The owner is invited by email and becomes
                owner when they accept.
              </Text>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="halo-owner-email">Owner email (optional)</Label>
                <Input
                  id="halo-owner-email"
                  type="email"
                  autoComplete="off"
                  {...register('ownerEmail')}
                  placeholder="owner@client.com"
                />
                {errors.ownerEmail && (
                  <Text size="xs" variant="destructive">
                    {errors.ownerEmail.message}
                  </Text>
                )}
              </div>
              <Button type="submit" loading={saving}>
                Create organization
              </Button>
            </Stack>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
