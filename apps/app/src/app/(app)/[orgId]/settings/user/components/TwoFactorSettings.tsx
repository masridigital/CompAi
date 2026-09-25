import { TWO_FACTOR_SETUP_PATH } from '@/lib/two-factor';
import { Section, Text } from '@trycompai/design-system';
import Link from 'next/link';

/** Entry point from user settings to the account-level 2FA page. */
export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  return (
    <Section
      title="Two-factor authentication"
      description={
        enabled
          ? 'Two-factor authentication is on for your account.'
          : 'Add a second step to sign-in with an authenticator app.'
      }
    >
      <Link
        href={TWO_FACTOR_SETUP_PATH}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        <Text as="span" size="sm" variant="primary">
          {enabled ? 'Manage two-factor authentication' : 'Set up two-factor authentication'}
        </Text>
      </Link>
    </Section>
  );
}
