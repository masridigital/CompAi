'use client';

import { Button, HStack, Stack, Text } from '@trycompai/design-system';
import { toast } from 'sonner';

interface BackupCodesPanelProps {
  codes: string[];
}

/** One-time display of backup codes, with copy + download. */
export function BackupCodesPanel({ codes }: BackupCodesPanelProps) {
  const text = codes.join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Backup codes copied');
    } catch {
      toast.error('Could not copy backup codes');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([`${text}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'comp-ai-backup-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Stack gap="md">
      <Text size="sm" variant="muted">
        Save these backup codes somewhere safe. Each code works once if you lose access to your
        authenticator app. They will not be shown again.
      </Text>
      <ul
        aria-label="Backup codes"
        className="grid grid-cols-1 gap-2 rounded-md bg-muted p-3 font-mono text-sm sm:grid-cols-2"
      >
        {codes.map((code) => (
          <li key={code} className="break-all">
            {code}
          </li>
        ))}
      </ul>
      <HStack gap="sm" wrap="wrap">
        <Button type="button" variant="outline" onClick={handleCopy}>
          Copy codes
        </Button>
        <Button type="button" variant="outline" onClick={handleDownload}>
          Download
        </Button>
      </HStack>
    </Stack>
  );
}
