'use client';

import { TotpCodeForm } from '@/components/two-factor/TotpCodeForm';
import { secretFromTotpUri } from '@/lib/two-factor';
import { authClient } from '@/utils/auth-client';
import { Button, Card, HStack, Stack, Text } from '@trycompai/design-system';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { toast } from 'sonner';
import { BackupCodesPanel } from './BackupCodesPanel';
import { DisableTwoFactorForm } from './DisableTwoFactorForm';

interface TwoFactorSetupProps {
  enabled: boolean;
  /** Staff under enforcement must keep 2FA on; they may only rotate codes. */
  canDisable: boolean;
  required: boolean;
}

type Step =
  | { kind: 'idle' }
  | { kind: 'scan'; totpURI: string; backupCodes: string[] }
  | { kind: 'done'; backupCodes: string[] };

export function TwoFactorSetup({ enabled, canDisable, required }: TwoFactorSetupProps) {
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [disabling, setDisabling] = useState(false);

  const handleEnable = async () => {
    setBusy(true);
    const { data, error } = await authClient.twoFactor.enable({});
    setBusy(false);
    if (error || !data) {
      toast.error(error?.message ?? 'Could not start two-factor setup');
      return;
    }
    setStep({ kind: 'scan', totpURI: data.totpURI, backupCodes: data.backupCodes });
  };

  const handleVerify = async (code: string): Promise<string | null> => {
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) return error.message ?? 'Invalid code. Try again.';
    if (step.kind === 'scan') setStep({ kind: 'done', backupCodes: step.backupCodes });
    setIsEnabled(true);
    toast.success('Two-factor authentication is on');
    return null;
  };

  const handleRegenerate = async () => {
    setBusy(true);
    const { data, error } = await authClient.twoFactor.generateBackupCodes({});
    setBusy(false);
    if (error || !data) {
      toast.error(error?.message ?? 'Could not generate new backup codes');
      return;
    }
    setStep({ kind: 'done', backupCodes: data.backupCodes });
  };

  const handleDisabled = () => {
    setIsEnabled(false);
    setDisabling(false);
    setStep({ kind: 'idle' });
    toast.success('Two-factor authentication is off');
  };

  const handleContinue = () => {
    window.location.assign('/');
  };

  if (step.kind === 'scan') {
    const secret = secretFromTotpUri(step.totpURI);
    return (
      <Card
        title="Scan the QR code"
        description="Use an authenticator app such as 1Password, Authy or Google Authenticator."
      >
        <Stack gap="lg">
          <div className="flex justify-center rounded-md bg-white p-4 sm:justify-start sm:self-start">
            <QRCodeSVG value={step.totpURI} size={176} aria-label="Two-factor QR code" />
          </div>
          {secret ? (
            <Stack gap="xs">
              <Text size="sm" variant="muted">
                Can&apos;t scan? Enter this key manually:
              </Text>
              <code className="break-all rounded bg-muted px-2 py-1 font-mono text-sm">
                {secret}
              </code>
            </Stack>
          ) : null}
          <TotpCodeForm onVerify={handleVerify} submitLabel="Verify and turn on" />
        </Stack>
      </Card>
    );
  }

  if (step.kind === 'done') {
    return (
      <Card title="Your backup codes">
        <Stack gap="lg">
          <BackupCodesPanel codes={step.backupCodes} />
          <div>
            <Button type="button" onClick={handleContinue}>
              Continue
            </Button>
          </div>
        </Stack>
      </Card>
    );
  }

  return (
    <Card
      title="Two-factor authentication"
      description={
        isEnabled
          ? 'Two-factor authentication is on for your account.'
          : 'Protect your account with a code from an authenticator app.'
      }
    >
      <Stack gap="md">
        {required && !isEnabled ? (
          <div role="status" className="rounded-md bg-muted p-3">
            <Text size="sm">
              Your account has staff access, so two-factor authentication is required before you can
              continue.
            </Text>
          </div>
        ) : null}
        {isEnabled && disabling ? (
          <DisableTwoFactorForm onDisabled={handleDisabled} onCancel={() => setDisabling(false)} />
        ) : null}
        {isEnabled && !disabling ? (
          <Stack gap="sm">
            <HStack gap="sm" wrap="wrap">
              <Button type="button" variant="outline" loading={busy} onClick={handleRegenerate}>
                Generate new backup codes
              </Button>
              {canDisable ? (
                <Button type="button" variant="destructive" onClick={() => setDisabling(true)}>
                  Turn off
                </Button>
              ) : null}
            </HStack>
            {!canDisable ? (
              <Text size="sm" variant="muted">
                Staff accounts must keep two-factor authentication on. You can rotate your backup
                codes at any time.
              </Text>
            ) : null}
          </Stack>
        ) : null}
        {!isEnabled ? (
          <div>
            <Button type="button" loading={busy} onClick={handleEnable}>
              Set up two-factor authentication
            </Button>
          </div>
        ) : null}
      </Stack>
    </Card>
  );
}
