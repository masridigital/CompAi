'use client';

import { issueHaloWebhookToken, useHaloConnections } from '@/hooks/use-admin-halopsa';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Label,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
} from '@trycompai/design-system';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

const tokenSchema = z.object({ connectionId: z.string().min(1, 'Choose a connection') });
type TokenFormValues = z.infer<typeof tokenSchema>;

export function WebhookTokenSection() {
  const { connections, isLoading, mutate } = useHaloConnections();
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<{ url: string; organizationName: string } | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<TokenFormValues>({
    resolver: zodResolver(tokenSchema),
    defaultValues: { connectionId: '' },
  });

  const handleIssue = async ({ connectionId }: TokenFormValues) => {
    const connection = connections.find((c) => c.connectionId === connectionId);
    if (connection?.hasWebhookToken && !window.confirm('This replaces the existing webhook token. Continue?')) {
      return;
    }
    setIssuing(true);
    const response = await issueHaloWebhookToken({ connectionId });
    setIssuing(false);
    if (response.error || !response.data) {
      toast.error(response.error ?? 'Could not issue a token');
      return;
    }
    setIssued({ url: response.data.url, organizationName: connection?.organizationName ?? '' });
    void mutate();
  };

  const handleCopy = async () => {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.url);
    toast.success('Webhook URL copied');
  };

  return (
    <Section
      title="Webhook token"
      description="Generate the Halo webhook payload URL for a client connection. It is shown once."
    >
      <form onSubmit={handleSubmit(handleIssue)}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex w-full flex-col gap-1.5 md:max-w-sm">
            <Label>Connection</Label>
            <Controller
              control={control}
              name="connectionId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={(value) => field.onChange(value ?? '')}>
                  <SelectTrigger>
                    <SelectValue placeholder={isLoading ? 'Loading...' : 'Select an organization'} />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.map((c) => (
                      <SelectItem key={c.connectionId} value={c.connectionId}>
                        {`${c.organizationName}${c.haloClientId ? ` (Halo #${c.haloClientId})` : ''}${c.hasWebhookToken ? ' · has token' : ''}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.connectionId && (
              <Text size="xs" variant="destructive">
                {errors.connectionId.message}
              </Text>
            )}
          </div>
          <Button type="submit" loading={issuing}>
            Generate token
          </Button>
        </div>
      </form>

      {issued && (
        <div className="mt-4 flex flex-col gap-2 rounded-lg border p-4">
          <Text size="sm" weight="medium">
            {`Payload URL for ${issued.organizationName}`}
          </Text>
          <code className="break-all rounded bg-muted p-2 text-xs" data-testid="halo-webhook-url">
            {issued.url}
          </code>
          <Text size="xs" variant="muted">
            In Halo: Standard Webhook, POST, application/json, Bearer authentication with HALOPSA_WEBHOOK_SECRET.
          </Text>
          <div>
            <Button size="sm" variant="outline" onClick={handleCopy}>
              Copy URL
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
