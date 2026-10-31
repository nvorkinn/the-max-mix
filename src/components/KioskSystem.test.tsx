import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '../test/user';
import KioskSystem from './KioskSystem';

const kiosk = vi.hoisted(() => ({
  piVersion: vi.fn(),
  latestCommit: vi.fn(),
  latestRelease: vi.fn(),
  isRelease: (ref: string) => /^v\d/.test(ref),
  restartKiosk: vi.fn(),
  rebootPi: vi.fn(),
  updateKiosk: vi.fn()
}));
vi.mock('../utils/kiosk', () => kiosk);

const running = '5a39e9a';

describe('KioskSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kiosk.piVersion.mockReturnValue({ ref: 'v1.12.0', commit: running });
  });

  it('shows the running release and that it is the latest', async () => {
    kiosk.latestRelease.mockResolvedValue('v1.12.0');
    render(<KioskSystem />);
    expect(screen.getByText('v1.12.0')).toBeInTheDocument();
    expect(await screen.findByText('Up to date.')).toBeInTheDocument();
    expect(kiosk.latestRelease).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(kiosk.latestCommit).not.toHaveBeenCalled();
  });

  it('says when a newer release is out', async () => {
    kiosk.latestRelease.mockResolvedValue('v1.13.0');
    render(<KioskSystem />);
    expect(await screen.findByText(/v1\.13\.0 is out\. Tap Update now/)).toBeInTheDocument();
  });

  it('says when GitHub cannot be asked for the latest release', async () => {
    kiosk.latestRelease.mockResolvedValue(null);
    render(<KioskSystem />);
    expect(await screen.findByText('Could not check GitHub for a newer release.')).toBeInTheDocument();
  });

  it('shows the commit of a Pi pinned to a branch and that it is up to date', async () => {
    kiosk.piVersion.mockReturnValue({ ref: 'main', commit: running });
    kiosk.latestCommit.mockResolvedValue(`${running}0123456789abcdef0123456789abcdef0`);
    render(<KioskSystem />);
    expect(screen.getByText(`main ${running}`)).toBeInTheDocument();
    expect(await screen.findByText('Up to date.')).toBeInTheDocument();
    expect(kiosk.latestCommit).toHaveBeenCalledWith('main', expect.any(AbortSignal));
  });

  it('says when a newer commit is waiting on the pinned branch', async () => {
    kiosk.piVersion.mockReturnValue({ ref: 'main', commit: running });
    kiosk.latestCommit.mockResolvedValue('abcdef0123456789abcdef0123456789abcdef01');
    render(<KioskSystem />);
    expect(await screen.findByText(/main is now abcdef0\. Tap Update now/)).toBeInTheDocument();
  });

  it('copes with a Pi that does not say its version', () => {
    kiosk.piVersion.mockReturnValue(null);
    render(<KioskSystem />);
    expect(screen.getByText('The Pi did not say which version it runs.')).toBeInTheDocument();
    expect(kiosk.latestCommit).not.toHaveBeenCalled();
    expect(kiosk.latestRelease).not.toHaveBeenCalled();
  });

  it('updates only on a second tap and says it is updating', async () => {
    kiosk.latestRelease.mockResolvedValue(null);
    render(<KioskSystem />);
    await userEvent.click(screen.getByRole('button', { name: 'Update now' }));
    expect(kiosk.updateKiosk).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Tap again to update' }));
    expect(kiosk.updateKiosk).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Updating\. If there is a newer version/)).toBeInTheDocument();
  });

  it('restarts and reboots only on a second tap', async () => {
    kiosk.latestRelease.mockResolvedValue(null);
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
