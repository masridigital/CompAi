import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyTotp: vi.fn(),
  verifyBackupCode: vi.fn(),
  assign: vi.fn(),
}));

vi.mock('@/utils/auth-client', () => ({
  authClient: {
    twoFactor: { verifyTotp: mocks.verifyTotp, verifyBackupCode: mocks.verifyBackupCode },
  },
}));
vi.mock('@trycompai/design-system', async () => {
  const mod = await import('@/test-utils/mocks/design-system-two-factor');
  return mod.designSystemTwoFactorMock;
});

import { TwoFactorChallenge } from './TwoFactorChallenge';

const originalLocation = window.location;

describe('TwoFactorChallenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { origin: 'https://compliance.masri.tech', assign: mocks.assign },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('verifies the TOTP code and continues to the requested app page', async () => {
    mocks.verifyTotp.mockResolvedValue({ data: {}, error: null });
    render(<TwoFactorChallenge redirectTo="https://compliance.masri.tech/org_1/overview" />);

    fireEvent.change(screen.getByLabelText('Authentication code'), {
      target: { value: '654321' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('/org_1/overview'));
    expect(mocks.verifyTotp).toHaveBeenCalledWith({ code: '654321' });
  });

  it('never redirects to an untrusted origin', async () => {
    mocks.verifyTotp.mockResolvedValue({ data: {}, error: null });
    render(<TwoFactorChallenge redirectTo="https://evil.example/steal" />);

    fireEvent.change(screen.getByLabelText('Authentication code'), {
      target: { value: '654321' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('/'));
  });

  it('accepts a backup code instead', async () => {
    mocks.verifyBackupCode.mockResolvedValue({ data: {}, error: null });
    render(
      <TwoFactorChallenge
        redirectTo="https://employee.compliance.masri.tech"
        portalUrl="https://employee.compliance.masri.tech"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use a backup code' }));
    fireEvent.change(screen.getByLabelText('Backup code'), {
      target: { value: 'aaaa-1111' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith('https://employee.compliance.masri.tech/'),
    );
    expect(mocks.verifyBackupCode).toHaveBeenCalledWith({ code: 'aaaa-1111' });
  });

  it('shows an error and stays on the page for a wrong code', async () => {
    mocks.verifyTotp.mockResolvedValue({ data: null, error: { message: 'Invalid code' } });
    render(<TwoFactorChallenge />);

    fireEvent.change(screen.getByLabelText('Authentication code'), {
      target: { value: '111111' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('Invalid code')).toBeTruthy();
    expect(mocks.assign).not.toHaveBeenCalled();
  });
});
