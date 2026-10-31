import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '../test/user';
import type { PiUpdate, UpdateStatus } from '../utils/piUpdate';
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

// The Pi's update status: the real descriptions, with a snapshot each test sets.
const NOW = 1_800_000_000_000;
const piUpdate = vi.hoisted(() => {
  const snapshot: PiUpdate = { status: null, reachable: null, requestedAt: null, checkedAt: 0 };
  return { snapshot, listeners: new Set<() => void>(), watchPiUpdates: vi.fn(), noteUpdateRequested: vi.fn() };
});
vi.mock('../utils/piUpdate', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/piUpdate')>()),
  watchPiUpdates: piUpdate.watchPiUpdates,
  noteUpdateRequested: piUpdate.noteUpdateRequested,
  getPiUpdate: () => piUpdate.snapshot,
  subscribePiUpdate: (listener: () => void) => {
    piUpdate.listeners.add(listener);
    return () => piUpdate.listeners.delete(listener);
  }
}));

function setUpdate(next: Partial<PiUpdate>) {
  piUpdate.snapshot = { ...piUpdate.snapshot, checkedAt: NOW, ...next };
  for (const listener of piUpdate.listeners) listener();
}

function run(fields: Partial<UpdateStatus>): UpdateStatus {
  return { state: 'idle', ref: '', commit: '', started: NOW, updated: NOW, step: 0, total: 0, detail: '', ...fields };
}

const running = '5a39e9a';

describe('KioskSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    piUpdate.snapshot = { status: null, reachable: null, requestedAt: null, checkedAt: 0 };
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

  it('updates only on a second tap and follows the update', async () => {
    kiosk.latestRelease.mockResolvedValue('v1.13.0');
    piUpdate.noteUpdateRequested.mockImplementation(() => setUpdate({ requestedAt: NOW, reachable: true }));
    render(<KioskSystem />);
    expect(piUpdate.watchPiUpdates).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Update now' }));
    expect(kiosk.updateKiosk).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Tap again to update' }));
    expect(kiosk.updateKiosk).toHaveBeenCalledTimes(1);
    expect(piUpdate.noteUpdateRequested).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Asking the Pi to update…');

    act(() => setUpdate({ status: run({ state: 'downloading', ref: 'v1.13.0' }) }));
    expect(screen.getByRole('status')).toHaveTextContent('Downloading v1.13.0…');
    expect(screen.getByRole('button', { name: 'Update now' })).toBeDisabled();

    act(() =>
      setUpdate({
        status: run({ state: 'installing', ref: 'v1.13.0', step: 20, total: 80, detail: 'Install Node.js' })
      })
    );
    expect(screen.getByRole('status')).toHaveTextContent('Installing v1.13.0: step 20 of about 80 (Install Node.js)…');
    expect(screen.getByRole('progressbar')).toHaveValue(25);

    act(() => setUpdate({ status: run({ state: 'restart-needed', ref: 'v1.13.0' }) }));
    expect(screen.getByRole('status')).toHaveTextContent('Installed v1.13.0. Restarting the kiosk…');
    expect(screen.getByRole('button', { name: 'Update now' })).toBeEnabled();
  });

  it('says when the Pi is already up to date or the update failed', () => {
    kiosk.latestRelease.mockResolvedValue('v1.12.0');
    render(<KioskSystem />);
    act(() => setUpdate({ requestedAt: NOW, reachable: true, status: run({ state: 'up-to-date', ref: 'v1.12.0' }) }));
    expect(screen.getByRole('status')).toHaveTextContent('Already up to date (v1.12.0).');

    act(() => setUpdate({ status: run({ state: 'failed', detail: 'Could not reach GitHub' }) }));
    expect(screen.getByRole('status')).toHaveTextContent('Update failed: Could not reach GitHub');
    expect(screen.getByRole('status')).toHaveClass('status-danger');
  });

  it('says when the Pi did not start the update, ignoring an older run', () => {
    kiosk.latestRelease.mockResolvedValue(null);
    render(<KioskSystem />);
    const older = run({ state: 'up-to-date', started: NOW - 60_000 });
    act(() => setUpdate({ requestedAt: NOW, reachable: true, status: older, checkedAt: NOW + 5000 }));
    expect(screen.getByRole('status')).toHaveTextContent('Asking the Pi to update…');
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    act(() => setUpdate({ checkedAt: NOW + 25_000 }));
    expect(screen.getByRole('status')).toHaveTextContent('The Pi has not started the update.');
  });

  it('keeps the old message on a Pi that cannot show its progress', () => {
    kiosk.latestRelease.mockResolvedValue(null);
    render(<KioskSystem />);
    act(() => setUpdate({ requestedAt: NOW, reachable: false }));
    expect(screen.getByRole('status')).toHaveTextContent(/Updating\. If there is a newer version/);
  });

  it('shows an update the Pi runs by itself, and what it left', () => {
    kiosk.latestRelease.mockResolvedValue('v1.13.0');
    render(<KioskSystem />);
    act(() => setUpdate({ status: run({ state: 'checking' }) }));
    expect(screen.getByRole('status')).toHaveTextContent('Checking GitHub for the latest version…');

    act(() => setUpdate({ status: run({ state: 'restart-needed', ref: 'v1.13.0' }) }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'v1.13.0 is installed and applies when the kiosk restarts (at 04:30, or tap Restart kiosk).'
    );

    act(() => setUpdate({ status: run({ state: 'failed', detail: 'Disk full' }) }));
    expect(screen.getByRole('status')).toHaveTextContent(/The last update \(\d\d:\d\d\) failed: Disk full/);
  });

  it('says what the last update installed once the kiosk runs it', async () => {
    kiosk.latestRelease.mockResolvedValue('v1.12.0');
    render(<KioskSystem />);
    act(() => setUpdate({ status: run({ state: 'restart-needed', ref: 'v1.12.0' }) }));
    expect(screen.getByRole('status')).toHaveTextContent('Updated to v1.12.0.');
    act(() => setUpdate({ checkedAt: NOW + 11 * 60_000 }));
    expect(await screen.findByText('Up to date.')).toBeInTheDocument();
  });

  it('matches a Pi pinned to a branch by its commit', () => {
    kiosk.piVersion.mockReturnValue({ ref: 'main', commit: running });
    kiosk.latestCommit.mockResolvedValue(null);
    render(<KioskSystem />);
    act(() => setUpdate({ status: run({ state: 'installed', ref: 'main', commit: `${running}${'0'.repeat(33)}` }) }));
    expect(screen.getByRole('status')).toHaveTextContent('Updated to main.');
    act(() => setUpdate({ status: run({ state: 'installed', ref: 'main', commit: 'f'.repeat(40) }) }));
    expect(screen.getByRole('status')).toHaveTextContent('main is installed and applies when the kiosk restarts');
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
