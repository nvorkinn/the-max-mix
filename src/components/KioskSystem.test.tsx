import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '../test/user';
import KioskSystem from './KioskSystem';

const kiosk = vi.hoisted(() => ({
  piVersion: vi.fn(),
  latestCommit: vi.fn(),
  restartKiosk: vi.fn(),
  rebootPi: vi.fn(),
  updateKiosk: vi.fn()
}));
vi.mock('../utils/kiosk', () => kiosk);

const running = '5a39e9a';

describe('KioskSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kiosk.piVersion.mockReturnValue({ ref: 'stable', commit: running });
  });

  it('shows the running commit and that it is up to date', async () => {
    kiosk.latestCommit.mockResolvedValue(`${running}0123456789abcdef0123456789abcdef0`);
    render(<KioskSystem />);
    expect(screen.getByText(`stable ${running}`)).toBeInTheDocument();
    expect(await screen.findByText('Up to date.')).toBeInTheDocument();
    expect(kiosk.latestCommit).toHaveBeenCalledWith('stable', expect.any(AbortSignal));
  });

  it('says when a newer commit is waiting', async () => {
    kiosk.latestCommit.mockResolvedValue('abcdef0123456789abcdef0123456789abcdef01');
    render(<KioskSystem />);
    expect(await screen.findByText(/stable is now abcdef0\. Tap Update now/)).toBeInTheDocument();
  });

  it('says when GitHub cannot be asked', async () => {
    kiosk.latestCommit.mockResolvedValue(null);
    render(<KioskSystem />);
    expect(await screen.findByText('Could not check GitHub for a newer stable.')).toBeInTheDocument();
  });

  it('copes with a Pi that does not say its version', () => {
    kiosk.piVersion.mockReturnValue(null);
    render(<KioskSystem />);
    expect(screen.getByText('The Pi did not say which version it runs.')).toBeInTheDocument();
    expect(kiosk.latestCommit).not.toHaveBeenCalled();
  });

  it('updates only on a second tap and says it is updating', async () => {
    kiosk.latestCommit.mockResolvedValue(null);
    render(<KioskSystem />);
    await userEvent.click(screen.getByRole('button', { name: 'Update now' }));
    expect(kiosk.updateKiosk).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Tap again to update' }));
    expect(kiosk.updateKiosk).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Updating\. If there is a newer version/)).toBeInTheDocument();
  });

  it('restarts and reboots only on a second tap', async () => {
    kiosk.latestCommit.mockResolvedValue(null);
    render(<KioskSystem />);
    await userEvent.click(screen.getByRole('button', { name: 'Restart kiosk' }));
    expect(kiosk.restartKiosk).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Tap again to restart' }));
    expect(kiosk.restartKiosk).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Reboot Pi' }));
    expect(kiosk.rebootPi).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Tap again to reboot' }));
    expect(kiosk.rebootPi).toHaveBeenCalledTimes(1);
  });
});
