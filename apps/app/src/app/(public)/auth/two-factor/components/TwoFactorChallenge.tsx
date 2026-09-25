'use client';

import { TotpCodeForm } from '@/components/two-factor/TotpCodeForm';
import {
  backupCodeSchema,
  resolvePostTwoFactorRedirect,
  type BackupCodeValues,
} from '@/lib/two-factor';
import { authClient } from '@/utils/auth-client';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Card, Input, Label, Stack, Text } from '@trycompai/design-system';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

interface TwoFactorChallengeProps {
  /** Untrusted destination from the query string; validated before use. */
  redirectTo?: string;
  portalUrl?: string;
}

export function TwoFactorChallenge({ redirectTo, portalUrl }: TwoFactorChallengeProps) {
  const [useBackupCode, setUseBackupCode] = useState(false);

  const handleSuccess = () => {
    window.location.assign(
      resolvePostTwoFactorRedirect({
        redirectTo,
        appOrigin: window.location.origin,
        portalUrl,
      }),
    );
  };

  const handleVerifyTotp = async (code: string): Promise<string | null> => {
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) return error.message ?? 'Invalid code. Try again.';
    handleSuccess();
    return null;
  };

  return (
    <Card
      width="full"
      maxWidth="md"
      title="Two-factor authentication"
      description={
        useBackupCode
          ? 'Enter one of your backup codes.'
          : 'Enter the 6-digit code from your authenticator app.'
      }
    >
      <Stack gap="lg">
        {useBackupCode ? (
          <BackupCodeForm onSuccess={handleSuccess} />
        ) : (
          <TotpCodeForm onVerify={handleVerifyTotp} />
        )}
        <div>
          <Button type="button" variant="link" onClick={() => setUseBackupCode((v) => !v)}>
            {useBackupCode ? 'Use authenticator app instead' : 'Use a backup code'}
          </Button>
        </div>
      </Stack>
    </Card>
  );
}

function BackupCodeForm({ onSuccess }: { onSuccess: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<BackupCodeValues>({
    resolver: zodResolver(backupCodeSchema),
    defaultValues: { code: '' },
  });

  const handleVerify = handleSubmit(async ({ code }) => {
    setServerError(null);
    const { error } = await authClient.twoFactor.verifyBackupCode({ code });
    if (error) {
      setServerError(error.message ?? 'Invalid backup code.');
      return;
    }
    onSuccess();
  });

  const message = errors.code?.message ?? serverError;

  return (
    <form onSubmit={handleVerify} noValidate>
      <Stack gap="md">
        <Stack gap="sm">
          <Label htmlFor="backup-code">Backup code</Label>
          <div className="w-full sm:max-w-xs">
            <Input
              id="backup-code"
              autoComplete="one-time-code"
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
        <div>
          <Button type="submit" loading={isSubmitting}>
            Verify
          </Button>
        </div>
      </Stack>
    </form>
  );
}
