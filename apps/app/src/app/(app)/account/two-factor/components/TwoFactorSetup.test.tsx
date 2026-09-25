import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enable: vi.fn(),
  verifyTotp: vi.fn(),
  generateBackupCodes: vi.fn(),
  disable: vi.fn(),
  $fetch: vi.fn(),
}));

vi.mock('@/utils/auth-client', () => ({
  authClient: {
    twoFactor: {
      enable: mocks.enable,
      verifyTotp: mocks.verifyTotp,
      generateBackupCodes: mocks.generateBackupCodes,
      disable: mocks.disable,
    },
    $fetch: mocks.$fetch,
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <svg data-testid="qr" data-value={value} />,
}));
vi.mock('@trycompai/design-system', async () => {
  const mod = await import('@/test-utils/mocks/design-system-two-factor');
  return mod.designSystemTwoFactorMock;
});

import { toast } from 'sonner';
import { TwoFactorSetup } from './TwoFactorSetup';

const TOTP_URI = 'otpauth://totp/Comp%20AI:staff@msp.test?secret=JBSWY3DPEHPK3PXP&issuer=Comp%20AI';
const BACKUP_CODES = ['aaaa-1111', 'bbbb-2222'];

async function startSetup() {
  mocks.enable.mockResolvedValue({
    data: { totpURI: TOTP_URI, backupCodes: BACKUP_CODES },
    error: null,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Set up two-factor authentication' }));
  await screen.findByTestId('qr');
}

function enterCode(code: string) {
  fireEvent.change(screen.getByLabelText('Authentication code'), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Verify and turn on' }));
}

describe('TwoFactorSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enables 2FA: shows the QR code and manual key, verifies, then shows backup codes', async () => {
    render(<TwoFactorSetup enabled={false} canDisable required={false} />);
    await startSetup();

    expect(mocks.enable).toHaveBeenCalledWith({});
    expect(screen.getByTestId('qr').getAttribute('data-value')).toBe(TOTP_URI);
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeTruthy();

    mocks.verifyTotp.mockResolvedValue({ data: { token: 't' }, error: null });
    enterCode('123456');

    await screen.findByText('Your backup codes');
    expect(mocks.verifyTotp).toHaveBeenCalledWith({ code: '123456' });
    expect(screen.getByText('aaaa-1111')).toBeTruthy();
    expect(screen.getByText('bbbb-2222')).toBeTruthy();
  });

  it('validates the code format before calling the API', async () => {
    render(<TwoFactorSetup enabled={false} canDisable required={false} />);
    await startSetup();

    enterCode('12ab');

    expect(
      await screen.findByText('Enter the 6-digit code from your authenticator app'),
    ).toBeTruthy();
    expect(mocks.verifyTotp).not.toHaveBeenCalled();
  });

  it('shows the API error when the code is wrong', async () => {
    render(<TwoFactorSetup enabled={false} canDisable required={false} />);
    await startSetup();

    mocks.verifyTotp.mockResolvedValue({ data: null, error: { message: 'Invalid code' } });
    enterCode('000000');

    expect(await screen.findByText('Invalid code')).toBeTruthy();
    expect(screen.queryByText('Your backup codes')).toBeNull();
  });

  it('surfaces an error when setup cannot start', async () => {
    mocks.enable.mockResolvedValue({ data: null, error: { message: 'Session too old' } });
    render(<TwoFactorSetup enabled={false} canDisable required={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Set up two-factor authentication' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Session too old'));
    expect(screen.queryByTestId('qr')).toBeNull();
  });

  it('explains the requirement to staff who have not enabled 2FA', () => {
    render(<TwoFactorSetup enabled={false} canDisable={false} required />);
    expect(screen.getByRole('status').textContent).toContain('required');
  });

  it('hides "Turn off" for staff and shows it for other users', () => {
    const { rerender } = render(<TwoFactorSetup enabled canDisable={false} required={false} />);
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();

    rerender(<TwoFactorSetup enabled canDisable required={false} />);
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeTruthy();
  });

  it('regenerates backup codes when 2FA is already on', async () => {
    mocks.generateBackupCodes.mockResolvedValue({
      data: { status: true, backupCodes: ['cccc-3333'] },
      error: null,
    });
    render(<TwoFactorSetup enabled canDisable required={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate new backup codes' }));

    expect(await screen.findByText('cccc-3333')).toBeTruthy();
  });

  it('staff under enforcement can only rotate codes and see why', () => {
    render(<TwoFactorSetup enabled canDisable={false} required={false} />);
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Generate new backup codes' })).toBeTruthy();
    expect(screen.getByText(/Staff accounts must keep two-factor/)).toBeTruthy();
  });

  describe('turning 2FA off', () => {
    function openDisableForm() {
      render(<TwoFactorSetup enabled canDisable required={false} />);
      fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    }

    function submit(label: string, value: string) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: 'Turn off two-factor authentication' }));
    }

    it('requires a valid authenticator code before calling the API', async () => {
      openDisableForm();
      submit('Authentication code', '12');
      expect(
        await screen.findByText('Enter the 6-digit code from your authenticator app'),
      ).toBeTruthy();
      expect(mocks.$fetch).not.toHaveBeenCalled();
      expect(mocks.disable).not.toHaveBeenCalled();
    });

    it('sends the TOTP code to the disable endpoint', async () => {
      mocks.$fetch.mockResolvedValue({ data: { status: true }, error: null });
      openDisableForm();
      submit('Authentication code', '123456');

      await screen.findByRole('button', { name: 'Set up two-factor authentication' });
      expect(mocks.$fetch).toHaveBeenCalledWith('/two-factor/disable', {
        method: 'POST',
        body: { code: '123456' },
      });
    });

    it('accepts a backup code instead', async () => {
      mocks.$fetch.mockResolvedValue({ data: { status: true }, error: null });
      openDisableForm();
      fireEvent.click(screen.getByRole('button', { name: 'Use a backup code' }));
      submit('Backup code', 'aaaa-1111');

      await waitFor(() =>
        expect(mocks.$fetch).toHaveBeenCalledWith('/two-factor/disable', {
          method: 'POST',
          body: { backupCode: 'aaaa-1111' },
        }),
      );
    });

    it('stays on and shows the API error for a wrong code', async () => {
      mocks.$fetch.mockResolvedValue({
        data: null,
        error: { message: 'Invalid authenticator or backup code.' },
      });
      openDisableForm();
      submit('Authentication code', '000000');

      expect(await screen.findByText('Invalid authenticator or backup code.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Set up two-factor authentication' })).toBeNull();
    });
  });
});
