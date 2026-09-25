import { generateUnsubscribeToken } from '@trycompai/email';

/** List-Unsubscribe headers for Gmail/RFC 8058 one-click compliance. */
export function buildListUnsubscribeHeaders(
  recipient: string,
): Record<string, string> {
  const apiBaseUrl =
    process.env.NEXT_PUBLIC_API_URL || 'https://api.trycomp.ai';
  const token = generateUnsubscribeToken(recipient);
  const oneClickUrl = `${apiBaseUrl}/v1/email/unsubscribe?email=${encodeURIComponent(recipient)}&token=${encodeURIComponent(token)}`;
  return {
    'List-Unsubscribe': `<${oneClickUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/** Trigger.dev `delay` for a future scheduledAt, or undefined to run now. */
export function scheduledAtToDelay(
  scheduledAt: string | undefined,
): Date | undefined {
  if (!scheduledAt) return undefined;
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    return undefined;
  }
  return date;
}
