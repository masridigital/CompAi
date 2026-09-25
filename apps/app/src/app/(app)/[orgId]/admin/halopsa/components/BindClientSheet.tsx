'use client';

import {
  bindHaloClient,
  type HaloClientRow,
  type HaloOrgOption,
} from '@/hooks/use-admin-halopsa';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Stack,
  Text,
} from '@trycompai/design-system';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

const bindSchema = z.object({
  organizationId: z.string().min(1, 'Choose an organization'),
  haloSiteId: z
    .string()
    .trim()
    .regex(/^\d*$/, 'Site ID must be a number')
    .optional(),
});

type BindFormValues = z.infer<typeof bindSchema>;

interface BindClientSheetProps {
  client: HaloClientRow | null;
  organizations: HaloOrgOption[];
  onClose: () => void;
  onBound: () => void;
}

export function BindClientSheet({ client, organizations, onClose, onBound }: BindClientSheetProps) {
  const [saving, setSaving] = useState(false);
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BindFormValues>({
    resolver: zodResolver(bindSchema),
    defaultValues: { organizationId: '', haloSiteId: '' },
  });

  useEffect(() => {
    if (!client) return;
    reset({ organizationId: client.suggestions[0]?.organizationId ?? '', haloSiteId: '' });
  }, [client, reset]);

  const handleBind = async (values: BindFormValues) => {
    if (!client) return;
    setSaving(true);
    const response = await bindHaloClient({
      haloClientId: client.id,
      organizationId: values.organizationId,
      haloSiteId: values.haloSiteId ? Number(values.haloSiteId) : undefined,
    });
    setSaving(false);
    if (response.error) {
      toast.error(response.error);
      return;
    }
    toast.success(`Bound ${client.name}`);
    onBound();
    onClose();
  };

  const suggested = new Set(client?.suggestions.map((s) => s.organizationId) ?? []);

  return (
    <Sheet open={client !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Bind {client?.name ?? 'Halo client'}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <form onSubmit={handleSubmit(handleBind)}>
            <Stack gap="md">
              <div className="flex flex-col gap-1.5">
                <Label>Organization</Label>
                <Controller
                  control={control}
                  name="organizationId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={(value) => field.onChange(value ?? '')}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an organization" />
                      </SelectTrigger>
                      <SelectContent>
                        {organizations.map((org) => (
                          <SelectItem key={org.id} value={org.id}>
                            {suggested.has(org.id) ? `${org.name} (suggested)` : org.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.organizationId && (
                  <Text size="xs" variant="destructive">
                    {errors.organizationId.message}
                  </Text>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="halo-site-id">Halo site ID (optional)</Label>
                <Input id="halo-site-id" inputMode="numeric" {...register('haloSiteId')} placeholder="57" />
                {errors.haloSiteId && (
                  <Text size="xs" variant="destructive">
                    {errors.haloSiteId.message}
                  </Text>
                )}
              </div>

              <Button type="submit" loading={saving}>
                Bind client
              </Button>
            </Stack>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
