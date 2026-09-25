'use client';

import { totpCodeSchema, type TotpCodeValues } from '@/lib/two-factor';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input, Label, Stack, Text } from '@trycompai/design-system';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

interface TotpCodeFormProps {
  /** Resolve with an error message to show, or null on success. */
  onVerify: (code: string) => Promise<string | null>;
  submitLabel?: string;
  inputId?: string;
}

/** 6-digit authenticator code form (setup verification + sign-in challenge). */
export function TotpCodeForm({
  onVerify,
  submitLabel = 'Verify',
  inputId = 'totp-code',
}: TotpCodeFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TotpCodeValues>({
    resolver: zodResolver(totpCodeSchema),
    defaultValues: { code: '' },
  });

  const handleVerify = handleSubmit(async ({ code }) => {
    setServerError(null);
    const error = await onVerify(code);
    if (error) setServerError(error);
  });

  const message = errors.code?.message ?? serverError;

  return (
    <form onSubmit={handleVerify} noValidate>
      <Stack gap="md">
        <Stack gap="sm">
          <Label htmlFor={inputId}>Authentication code</Label>
          <div className="w-full sm:max-w-[12rem]">
            <Input
              id={inputId}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              aria-invalid={message ? true : undefined}
              aria-describedby={message ? `${inputId}-error` : undefined}
              {...register('code')}
            />
          </div>
          {message ? (
            <div id={`${inputId}-error`} role="alert">
              <Text size="sm" variant="destructive">
                {message}
              </Text>
            </div>
          ) : null}
        </Stack>
        <div>
          <Button type="submit" loading={isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      </Stack>
    </form>
  );
}
