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
const STABLE = { channel: 'stable', current: `v1.12.0+${running}0`, installed: null, failed: null, busy: false };
const CURRENT = { result: 'up-to-date', latest: `v1.12.0+${running}0` };
const NEWER = { result: 'available', latest: 'v1.13.0+bbbbbbb0' };
/** The kiosk service's answer to POST /update/check from now on; null for a service that does not answer. */
const channel = (body: Record<string, unknown> | null) => {
  const fetch = vi.fn(() =>
    body ? Promise.resolve(Response.json({ ...STABLE, ...body })) : Promise.reject(new TypeError('Failed to fetch'))
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

describe('KioskSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeSockets();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    channel(CURRENT);
    kiosk.piVersion.mockReturnValue({ ref: 'v1.12.0', commit: running });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows the running release and that it is the latest', async () => {
    const fetch = channel(CURRENT);
    render(<Harness />);
    expect(screen.getByText('v1.12.0')).toBeInTheDocument();
    expect(await screen.findByText(UP_TO_DATE)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:7341/update/check',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('says when a newer release is out', async () => {
    channel(NEWER);
    render(<Harness />);
    expect(await screen.findAllByText('v1.13.0 is out.')).not.toHaveLength(0);
  });

  it('says when the channel cannot be read, or the service does not answer', async () => {
    channel({ result: 'unreachable', latest: null });
    const { unmount } = render(<Harness />);
    expect(await screen.findByText('Could not check for a newer release.')).toBeInTheDocument();
    unmount();

    channel(null);
    render(<Harness />);
    expect(await screen.findByText('Could not check for a newer release.')).toBeInTheDocument();
  });

  it('shows the commit of a Pi following a branch and that it is up to date', async () => {
    kiosk.piVersion.mockReturnValue({ ref: 'main', commit: running });
    channel({ channel: 'main', current: `main+${running}0`, result: 'up-to-date', latest: `main+${running}0` });
    render(<Harness />);
    expect(screen.getByText(`main ${running}`)).toBeInTheDocument();
    expect(await screen.findByText(UP_TO_DATE)).toBeInTheDocument();
  });

  it('says when a newer commit is waiting on the branch', async () => {
    kiosk.piVersion.mockReturnValue({ ref: 'main', commit: running });
    channel({ channel: 'main', current: `main+${running}0`, result: 'available', latest: 'main+abcdef01' });
    render(<Harness />);
    expect(await screen.findAllByText('main is now abcdef0.')).not.toHaveLength(0);
  });

  it('takes the version from the service when the page was not told it', async () => {
    kiosk.piVersion.mockReturnValue(null);
    render(<Harness />);
    expect(await screen.findByText('v1.12.0')).toBeInTheDocument();
  });

  it('copes with a Pi that does not say its version', async () => {
    kiosk.piVersion.mockReturnValue(null);
    channel(null);
    render(<Harness />);
    expect(screen.getByText('The Pi did not say which version it runs.')).toBeInTheDocument();
    await act(async () => {});
    expect(screen.getByText('The Pi did not say which version it runs.')).toBeInTheDocument();
  });

  describe('the check button', () => {
    const check = () => screen.getByRole('button', { name: 'Check for updates' });
    const popup = () => screen.queryByRole('dialog', { name: 'Update available', hidden: true });

    it('asks again, and shows what it finds without a popup when nothing is newer', async () => {
      const fetch = channel(CURRENT);
      render(<Harness />);
      expect(await screen.findByText(UP_TO_DATE)).toBeInTheDocument();
      await userEvent.click(check());
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(await screen.findByText(UP_TO_DATE)).toBeInTheDocument();
      expect(popup()).not.toBeInTheDocument();
    });

    it('says when the channel was last read, and keeps that time when a check cannot read it', async () => {
      render(<Harness />);
      const shown = await screen.findByText(UP_TO_DATE);
      const first = shown.textContent;
      channel({ result: 'unreachable', latest: null });
      await userEvent.click(check());
      await waitFor(() => expect(check()).toBeEnabled());
      expect(screen.getByText(UP_TO_DATE)).toHaveTextContent(first);
    });

    it('spins while it checks, even when the service answers at once', async () => {
      render(<Harness />);
      await screen.findByText(UP_TO_DATE);
      await userEvent.click(check());
      expect(check()).toBeDisabled();
      expect(check().querySelector('svg')).toHaveClass('animate-spin');
      await waitFor(() => expect(check()).toBeEnabled());
      expect(check().querySelector('svg')).not.toHaveClass('animate-spin');
    });

    it('is busy while the service is asked', () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise(() => {}))
      );
      render(<Harness />);
      expect(check()).toBeDisabled();
    });

    it('opens the popup for a newer version it finds, where the update starts', async () => {
      render(<Harness />);
      await screen.findByText(UP_TO_DATE);
      channel(NEWER);
      await userEvent.click(check());
      expect(await screen.findByRole('dialog', { name: 'Update available', hidden: true })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Update now', hidden: true }));
      expect(latestFakeSocket().url).toBe('ws://127.0.0.1:7341/power/update');
    });

    it('after Not now, says what is newer and asks again when pressed', async () => {
      channel(NEWER);
      render(<Harness />);
      await userEvent.click(await screen.findByRole('button', { name: 'Not now', hidden: true }));
      expect(popup()).not.toBeInTheDocument();
      expect(kiosk.setDismissedUpdate).toHaveBeenCalledWith('v1.13.0+bbbbbbb0');
      expect(screen.getByText('v1.13.0 is out.')).toBeInTheDocument();

      await userEvent.click(check());
      expect(await screen.findByRole('dialog', { name: 'Update available', hidden: true })).toBeInTheDocument();
    });

    it('cannot be pressed when the Pi did not say its version', () => {
      kiosk.piVersion.mockReturnValue(null);
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise(() => {}))
      );
      render(<Harness />);
      expect(check()).toBeDisabled();
    });
  });

  it('says it is updating once the popup starts the update', async () => {
    channel(NEWER);
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
      channel(NEWER);
      render(<Harness />);
      await userEvent.click(await screen.findByRole('button', { name: 'Update now', hidden: true }));
      act(() => latestFakeSocket().open());
    };
    const receive = (frame: unknown) => act(() => latestFakeSocket().receive(frame));

    it('shows the lines as they arrive, writes each once to the debug console and ends when done', async () => {
      await tap();
      receive({ type: 'status', state: 'installing' });
      receive({ type: 'log', line: '2026-11-04T20:00:00+0000 kiosk-update[1]: Installing v1.13.0+bbbbbbb0' });
      expect(screen.getByLabelText('Update output')).toHaveTextContent('Installing v1.13.0+bbbbbbb0');
      receive({ type: 'log', line: '2026-11-04T20:00:09+0000 kiosk-update[1]: Installed v1.13.0+bbbbbbb0' });
      expect(screen.getByLabelText('Update output')).toHaveTextContent('bbbbbbb0 2026-11-04T20:00:09');
      receive({ type: 'status', state: 'done', message: 'Nothing needed a restart.' });
      act(() => latestFakeSocket().end());
      // The settings section and the console both say it.
      expect(screen.getAllByText('Update finished. Nothing needed a restart.')).toHaveLength(2);
      // The console stays up with its output after the update ends, until it is closed; checking is usable again.
      expect(screen.getByLabelText('Update output')).toHaveTextContent('Installed v1.13.0+bbbbbbb0');
      expect(screen.getByRole('button', { name: 'Check for updates', hidden: true })).toBeEnabled();
      await userEvent.click(screen.getByRole('button', { name: 'Close update console' }));
      expect(screen.queryByLabelText('Update output')).not.toBeInTheDocument();
      expect(debug.debugLog.mock.calls.map(call => String(call.at(2)))).toEqual([
        '2026-11-04T20:00:00+0000 kiosk-update[1]: Installing v1.13.0+bbbbbbb0',
        '2026-11-04T20:00:09+0000 kiosk-update[1]: Installed v1.13.0+bbbbbbb0'
      ]);
    });

    it('says when it failed', async () => {
      await tap();
      receive({ type: 'log', line: 'fatal: could not resolve host' });
      receive({ type: 'status', state: 'failed', message: 'rauc install ended with status 2.' });
      act(() => latestFakeSocket().end());
      // The settings section and the console both say it.
      expect(screen.getAllByText('The update failed. rauc install ended with status 2.')).toHaveLength(2);
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
      channel(NEWER);
      render(<Harness />);
      await userEvent.click(await screen.findByRole('button', { name: 'Update now', hidden: true }));
      act(() => latestFakeSocket().end());
      // The settings section and the console both say it.
      expect(screen.getAllByText('The kiosk service is not answering.')).toHaveLength(2);
    });
  });

  it('restarts and reboots only on a second tap', async () => {
    channel(null);
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

  it('installs and restarts from the row', async () => {
    channel(NEWER);
    render(<Harness />);
    await userEvent.click(await screen.findByRole('button', { name: 'Not now', hidden: true }));

    await userEvent.click(screen.getByRole('button', { name: 'Install' }));
    act(() => latestFakeSocket().open());
    act(() => latestFakeSocket().receive({ type: 'status', state: 'installing' }));
    act(() => latestFakeSocket().receive({ type: 'log', line: 'x kiosk-update[1]: Update progress: 60% Copying' }));
    expect(screen.getByLabelText('60% installed')).toBeInTheDocument();
    act(() => latestFakeSocket().receive({ type: 'status', state: 'installed', message: 'v1.13.0+bbbbbbb0' }));
    act(() => latestFakeSocket().end());

    expect(screen.getAllByText('v1.13.0 is installed. Restart to finish.').length).toBeGreaterThan(0);
    const restarts = screen.getAllByRole('button', { name: 'Restart now', hidden: true });
    expect(restarts).toHaveLength(2);
    const [restart] = restarts;
    if (!restart) throw new Error('No Restart now button');
    await userEvent.click(restart);
    expect(kiosk.restartKiosk).toHaveBeenCalledTimes(1);
  });
});
