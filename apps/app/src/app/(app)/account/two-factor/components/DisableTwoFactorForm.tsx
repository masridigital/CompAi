'use client';

import { disableTwoFactorSchema, type DisableTwoFactorValues } from '@/lib/two-factor';
import { authClient } from '@/utils/auth-client';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, HStack, Input, Label, Stack, Text } from '@trycompai/design-system';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

interface DisableTwoFactorFormProps {
  onDisabled: () => void;
  onCancel: () => void;
}

/**
 * Turning 2FA off requires proof of the second factor: a current
 * authenticator code or an unused backup code (enforced by the API).
 */
export function DisableTwoFactorForm({ onDisabled, onCancel }: DisableTwoFactorFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<DisableTwoFactorValues>({
    resolver: zodResolver(disableTwoFactorSchema),
    defaultValues: { method: 'totp', code: '' },
  });
  const method = watch('method');

  const handleDisable = handleSubmit(async ({ method: kind, code }) => {
    setServerError(null);
    const body = kind === 'totp' ? { code } : { backupCode: code };
    const { error } = await authClient.$fetch('/two-factor/disable', {
      method: 'POST',
      body,
    });
    if (error) {
      setServerError(error.message ?? 'Could not turn off two-factor authentication');
      return;
    }
    onDisabled();
  });

  const handleToggleMethod = () => {
    setValue('method', method === 'totp' ? 'backup' : 'totp');
    setValue('code', '');
    setServerError(null);
  };

  const message = errors.code?.message ?? serverError;
  const label = method === 'totp' ? 'Authentication code' : 'Backup code';

  return (
    <form onSubmit={handleDisable} noValidate>
      <Stack gap="md">
        <Stack gap="sm">
          <Label htmlFor="disable-2fa-code">{label}</Label>
          <div className="w-full sm:max-w-xs">
            <Input
              id="disable-2fa-code"
              autoComplete="one-time-code"
              inputMode={method === 'totp' ? 'numeric' : 'text'}
              aria-invalid={message ? true : undefined}
              {...register('code')}
            />
          </div>
          {message ? (
            <div role="alert">
              <Text size="sm" variant="destructive">
                {message}
              </Text>
            </div>
          ) : null}
        </Stack>
        <HStack gap="sm" wrap="wrap">
          <Button type="submit" variant="destructive" loading={isSubmitting}>
            Turn off two-factor authentication
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="link" onClick={handleToggleMethod}>
            {method === 'totp' ? 'Use a backup code' : 'Use authenticator app'}
          </Button>
        </HStack>
      </Stack>
    </form>
  );
}
