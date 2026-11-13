import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FakeWebSocket, latestFakeSocket, resetFakeSockets } from '../test/fakeWebSocket';
import userEvent from '../test/user';
import { useKioskUpdate } from '../hooks/useKioskUpdate';
import KioskSystem from './KioskSystem';
import UpdateConsole from './UpdateConsole';
import UpdatePrompt from './UpdatePrompt';

/** The settings section, the update popup and the update console, wired to one update the way TabletView wires them. */
function Harness() {
  const update = useKioskUpdate(true);
  return (
    <>
      <KioskSystem update={update} />
      {update.prompting && update.newer && (
        <UpdatePrompt newer={update.newer} onUpdate={update.start} onLater={update.dismissPrompt} />
      )}
      <UpdateConsole update={update} />
    </>
  );
}

const kiosk = vi.hoisted(() => ({
  piVersion: vi.fn(),
  latestCommit: vi.fn(),
  latestRelease: vi.fn(),
  isRelease: (ref: string) => /^v\d/.test(ref),
  restartKiosk: vi.fn(),
  rebootPi: vi.fn(),
  getDismissedUpdate: vi.fn<() => string | null>(() => null),
  setDismissedUpdate: vi.fn()
}));
vi.mock('../utils/kiosk', () => kiosk);
const debug = vi.hoisted(() => ({ debugLog: vi.fn() }));
vi.mock('../utils/debugLog', () => debug);

const running = '5a39e9a';
const UP_TO_DATE = /^Up to date as of \d\d:\d\d:\d\d\.$/;

describe('KioskSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeSockets();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    kiosk.piVersion.mockReturnValue({ ref: 'v1.12.0', commit: running });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows the running release and that it is the latest', async () => {
    kiosk.latestRelease.mockResolvedValue({ tag: 'v1.12.0', ready: true });
    render(<Harness />);
    expect(screen.getByText('v1.12.0')).toBeInTheDocument();
    expect(await screen.findByText(UP_TO_DATE)).toBeInTheDocument();
    expect(kiosk.latestRelease).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(kiosk.latestCommit).not.toHaveBeenCalled();
  });

  it('says when a newer release is out', async () => {
    kiosk.latestRelease.mockResolvedValue({ tag: 'v1.13.0', ready: true });
    render(<Harness />);
    expect(await screen.findByText(/v1\.13\.0 is out\. Tap the button to install it now/)).toBeInTheDocument();
  });

  it('says when GitHub cannot be asked for the latest release', async () => {
    kiosk.latestRelease.mockResolvedValue(null);
    render(<Harness />);
    expect(await screen.findByText('Could not check GitHub for a newer release.')).toBeInTheDocument();
  });

  it('shows the commit of a Pi pinned to a branch and that it is up to date', async () => {
    kiosk.piVersion.mockReturnValue({ ref: 'main', commit: running });
    kiosk.latestCommit.mockResolvedValue(`${running}0123456789abcdef0123456789abcdef0`);
    render(<Harness />);
    expect(screen.getByText(`main ${running}`)).toBeInTheDocument();
    expect(await screen.findByText(UP_TO_DATE)).toBeInTheDocument();
    expect(kiosk.latestCommit).toHaveBeenCalledWith('main', expect.any(AbortSignal));
  });

  it('says when a newer commit is waiting on the pinned branch', async () => {
    kiosk.piVersion.mockReturnValue({ ref: 'main', commit: running });
    kiosk.latestCommit.mockResolvedValue('abcdef0123456789abcdef0123456789abcdef01');
    render(<Harness />);
    expect(await screen.findByText(/main is now abcdef0\. Tap the button to install it now/)).toBeInTheDocument();
  });

  it('copes with a Pi that does not say its version', () => {
    kiosk.piVersion.mockReturnValue(null);
    render(<Harness />);
    expect(screen.getByText('The Pi did not say which version it runs.')).toBeInTheDocument();
    expect(kiosk.latestCommit).not.toHaveBeenCalled();
    expect(kiosk.latestRelease).not.toHaveBeenCalled();
  });

  describe('the check button', () => {
    const check = () => screen.getByRole('button', { name: 'Check for updates' });
    const popup = () => screen.queryByRole('dialog', { name: 'Update available', hidden: true });

    it('asks GitHub again, and shows what it finds without a popup when nothing is newer', async () => {
      kiosk.latestRelease.mockResolvedValue({ tag: 'v1.12.0', ready: true });
      render(<Harness />);
      expect(await screen.findByText(UP_TO_DATE)).toBeInTheDocument();
      await userEvent.click(check());
      expect(kiosk.latestRelease).toHaveBeenCalledTimes(2);
      expect(await screen.findByText(UP_TO_DATE)).toBeInTheDocument();
      expect(popup()).not.toBeInTheDocument();
    });

    it('says when GitHub last answered, and keeps that time when a check cannot reach it', async () => {
      kiosk.latestRelease.mockResolvedValue({ tag: 'v1.12.0', ready: true });
      render(<Harness />);
      const shown = await screen.findByText(UP_TO_DATE);
      const first = shown.textContent;
      kiosk.latestRelease.mockResolvedValue(null);
      await userEvent.click(check());
      await waitFor(() => expect(check()).toBeEnabled());
      expect(screen.getByText(UP_TO_DATE)).toHaveTextContent(first);
    });

    it('spins while it checks, even when GitHub answers at once', async () => {
      kiosk.latestRelease.mockResolvedValue({ tag: 'v1.12.0', ready: true });
      render(<Harness />);
      await screen.findByText(UP_TO_DATE);
      await userEvent.click(check());
      expect(check()).toBeDisabled();
      expect(check().querySelector('svg')).toHaveClass('animate-spin');
      await waitFor(() => expect(check()).toBeEnabled());
      expect(check().querySelector('svg')).not.toHaveClass('animate-spin');
    });

    it('is busy while GitHub is asked', () => {
      kiosk.latestRelease.mockReturnValue(new Promise(() => {}));
      render(<Harness />);
      expect(check()).toBeDisabled();
    });

    it('opens the popup for a newer version it finds, where the update starts', async () => {
      kiosk.latestRelease.mockResolvedValue({ tag: 'v1.12.0', ready: true });
      render(<Harness />);
      await screen.findByText(UP_TO_DATE);
      kiosk.latestRelease.mockResolvedValue({ tag: 'v1.13.0', ready: true });
      await userEvent.click(check());
      expect(await screen.findByRole('dialog', { name: 'Update available', hidden: true })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Update now', hidden: true }));
      expect(latestFakeSocket().url).toBe('ws://127.0.0.1:7341/power/update');
    });

    it('after Not now, says what is newer and asks again when pressed', async () => {
      kiosk.latestRelease.mockResolvedValue({ tag: 'v1.13.0', ready: true });
      render(<Harness />);
      await userEvent.click(await screen.findByRole('button', { name: 'Not now', hidden: true }));
      expect(popup()).not.toBeInTheDocument();
      expect(kiosk.setDismissedUpdate).toHaveBeenCalledWith('v1.13.0');
      expect(screen.getByText(/v1\.13\.0 is out\. Tap the button to install it now/)).toBeInTheDocument();

      await userEvent.click(check());
      expect(await screen.findByRole('dialog', { name: 'Update available', hidden: true })).toBeInTheDocument();
    });

    it('cannot be pressed when the Pi did not say its version', () => {
      kiosk.piVersion.mockReturnValue(null);
      render(<Harness />);
      expect(check()).toBeDisabled();
    });
  });

  it('says it is updating once the popup starts the update', async () => {
    kiosk.latestRelease.mockResolvedValue({ tag: 'v1.13.0', ready: true });
    render(<Harness />);
    expect(() => latestFakeSocket()).toThrow('No WebSocket was opened');
    await userEvent.click(await screen.findByRole('button', { name: 'Update now', hidden: true }));
    expect(latestFakeSocket().url).toBe('ws://127.0.0.1:7341/power/update');
    expect(screen.getByText('Updating… this can take a few minutes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check for updates', hidden: true })).toBeDisabled();
    expect(screen.getByLabelText('Update output')).toHaveTextContent('Starting the update…');
    // While it runs there is nothing to go back to: no close button, and Escape does nothing.
    expect(screen.queryByRole('button', { name: 'Close update console' })).not.toBeInTheDocument();
    fireEvent(screen.getByRole('dialog', { hidden: true }), new Event('cancel', { cancelable: true }));
    expect(screen.getByLabelText('Update output')).toBeInTheDocument();
  });

  describe('while an update runs', () => {
    const tap = async () => {
      kiosk.latestRelease.mockResolvedValue({ tag: 'v1.13.0', ready: true });
      render(<Harness />);
      await userEvent.click(await screen.findByRole('button', { name: 'Update now', hidden: true }));
      act(() => latestFakeSocket().open());
    };
    const receive = (frame: unknown) => act(() => latestFakeSocket().receive(frame));

    it('shows the lines as they arrive, writes each once to the debug console and ends when done', async () => {
      await tap();
      receive({ type: 'status', state: 'pulling' });
      receive({ type: 'log', line: '2026-11-04T20:00:00+0000 kiosk-pull[1]: The latest release is v1.14.0' });
      expect(screen.getByLabelText('Update output')).toHaveTextContent('The latest release is v1.14.0');
      receive({ type: 'log', line: '2026-11-04T20:00:09+0000 kiosk-pull[1]: TASK [kiosk]' });
      expect(screen.getByLabelText('Update output')).toHaveTextContent('v1.14.0 2026-11-04T20:00:09');
      receive({ type: 'status', state: 'done', message: 'Nothing needed a restart.' });
      act(() => latestFakeSocket().end());
      // The settings section and the console both say it.
      expect(screen.getAllByText('Update finished. Nothing needed a restart.')).toHaveLength(2);
      // The console stays up with its output after the update ends, until it is closed; checking is usable again.
      expect(screen.getByLabelText('Update output')).toHaveTextContent('TASK [kiosk]');
      expect(screen.getByRole('button', { name: 'Check for updates', hidden: true })).toBeEnabled();
      await userEvent.click(screen.getByRole('button', { name: 'Close update console' }));
      expect(screen.queryByLabelText('Update output')).not.toBeInTheDocument();
      expect(debug.debugLog.mock.calls.map(call => String(call.at(2)))).toEqual([
        '2026-11-04T20:00:00+0000 kiosk-pull[1]: The latest release is v1.14.0',
        '2026-11-04T20:00:09+0000 kiosk-pull[1]: TASK [kiosk]'
      ]);
    });

    it('says when it failed', async () => {
      await tap();
      receive({ type: 'log', line: 'fatal: could not resolve host' });
      receive({ type: 'status', state: 'failed', message: 'The pull ended with status 2.' });
      act(() => latestFakeSocket().end());
      // The settings section and the console both say it.
      expect(screen.getAllByText('The update failed. The pull ended with status 2.')).toHaveLength(2);
      expect(screen.getByLabelText('Update output')).toHaveTextContent('fatal: could not resolve host');
    });

    it('says the kiosk is restarting when the connection ends in the restart', async () => {
      await tap();
      receive({ type: 'status', state: 'restarting' });
      act(() => latestFakeSocket().end());
      // The settings section and the console both say it; there is no way back while it restarts.
      expect(screen.getAllByText('Restarting the kiosk…')).toHaveLength(2);
      expect(screen.queryByRole('button', { name: 'Close update console' })).not.toBeInTheDocument();
    });

    it('says so when the service never answers', async () => {
      kiosk.latestRelease.mockResolvedValue({ tag: 'v1.13.0', ready: true });
      render(<Harness />);
      await userEvent.click(await screen.findByRole('button', { name: 'Update now', hidden: true }));
      act(() => latestFakeSocket().end());
      // The settings section and the console both say it.
      expect(screen.getAllByText('The kiosk service is not answering.')).toHaveLength(2);
    });
  });

  it('restarts and reboots only on a second tap', async () => {
    kiosk.latestRelease.mockResolvedValue(null);
    render(<Harness />);
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
