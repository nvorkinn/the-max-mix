import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { FakeWebSocket, fakeSocketCount, latestFakeSocket, resetFakeSockets } from '../test/fakeWebSocket';
import { STALLED_AFTER_MS, useKioskUpdate } from './useKioskUpdate';

const kiosk = vi.hoisted(() => ({
  piVersion: vi.fn(),
  isRelease: (ref: string) => /^v\d/.test(ref),
  getDismissedUpdate: vi.fn(),
  setDismissedUpdate: vi.fn()
}));
vi.mock('../utils/kiosk', () => kiosk);
const debug = vi.hoisted(() => ({ debugLog: vi.fn() }));
vi.mock('../utils/debugLog', () => debug);

const flush = () => act(async () => {});

const STABLE = { channel: 'stable', current: 'v1.12.0+5a39e9a0', installed: null, failed: null, busy: false };
/** The kiosk service's answer to POST /update/check from now on; null for a service that does not answer. */
const channel = (body: Record<string, unknown> | null) => {
  const fetch = vi.fn(() =>
    body ? Promise.resolve(Response.json({ ...STABLE, ...body })) : Promise.reject(new TypeError('Failed to fetch'))
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
const NEWER = { result: 'available', latest: 'v1.13.0+bbbbbbb2' };

describe('useKioskUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeSockets();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    channel(NEWER);
    kiosk.piVersion.mockReturnValue({ ref: 'v1.12.0', commit: '5a39e9a' });
    kiosk.getDismissedUpdate.mockReturnValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('asks its own service what the channel has, and asks about a newer version once it has answered', async () => {
    const { result } = renderHook(() => useKioskUpdate(true));
    expect(result.current).toMatchObject({ prompting: false, latest: { state: 'checking' }, isChecking: true });
    await flush();
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:7341/update/check',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.current).toMatchObject({
      version: { ref: 'v1.12.0', commit: '5a39e9a' },
      release: true,
      latest: { state: 'known', value: 'v1.13.0+bbbbbbb2' },
      newer: 'v1.13.0 is out',
      prompting: true,
      isChecking: false
    });
  });

  it('names a branch Pi by its commit', async () => {
    kiosk.piVersion.mockReturnValue(null);
    channel({ channel: 'dev', current: 'dev+aaaaaaa111', result: 'available', latest: 'dev+bbbbbbb222' });
    const { result } = renderHook(() => useKioskUpdate(true));
    await flush();
    expect(result.current).toMatchObject({
      version: { ref: 'dev', commit: 'aaaaaaa' },
      release: false,
      what: 'dev',
      newer: 'dev is now bbbbbbb'
    });
  });

  it('does not ask when up to date, when the channel cannot be read, or off the kiosk', async () => {
    channel({ result: 'up-to-date', latest: 'v1.12.0+5a39e9a0' });
    const upToDate = renderHook(() => useKioskUpdate(true));
    await flush();
    expect(upToDate.result.current).toMatchObject({ newer: null, prompting: false });

    channel({ result: 'unreachable', latest: null });
    const unreachable = renderHook(() => useKioskUpdate(true));
    await flush();
    expect(unreachable.result.current).toMatchObject({ latest: { state: 'unknown' }, newer: null, prompting: false });

    channel(null);
    const silent = renderHook(() => useKioskUpdate(true));
    await flush();
    expect(silent.result.current).toMatchObject({ latest: { state: 'unknown' }, newer: null, prompting: false });

    const fetch = channel(NEWER);
    const off = renderHook(() => useKioskUpdate(false));
    await flush();
    expect(off.result.current).toMatchObject({ version: null, newer: null, prompting: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says what waits for a restart, and what failed here before', async () => {
    channel({ installed: 'v1.13.0+bbb', result: 'installed', latest: 'v1.13.0+bbb' });
    const installed = renderHook(() => useKioskUpdate(true));
    await waitFor(() => expect(installed.result.current.installed).toBe('v1.13.0+bbb'));
    expect(installed.result.current).toMatchObject({ newer: null, prompting: false, release: true });

    channel({ result: 'failed', latest: 'v1.13.0+bbb' });
    const failed = renderHook(() => useKioskUpdate(true));
    await waitFor(() => expect(failed.result.current.failed).toBe('v1.13.0+bbb'));
    expect(failed.result.current.newer).toBeNull();
  });

  it('remembers "Not now" for that version only', async () => {
    const { result, rerender } = renderHook(() => useKioskUpdate(true));
    await flush();
    act(() => result.current.dismissPrompt());
    expect(kiosk.setDismissedUpdate).toHaveBeenCalledWith('v1.13.0+bbbbbbb2');
    expect(result.current.prompting).toBe(false);
    // The settings still say a newer version is out.
    expect(result.current.newer).toBe('v1.13.0 is out');
    rerender();

    // Another visit: the stored answer is for the same version, so no question; a newer one asks again.
    kiosk.getDismissedUpdate.mockReturnValue('v1.13.0+bbbbbbb2');
    const again = renderHook(() => useKioskUpdate(true));
    await flush();
    expect(again.result.current.prompting).toBe(false);
    channel({ result: 'available', latest: 'v1.14.0+ccccccc3' });
    const newest = renderHook(() => useKioskUpdate(true));
    await flush();
    expect(newest.result.current.prompting).toBe(true);
  });

  it('asks again after "Not now" when the person checks themselves', async () => {
    kiosk.getDismissedUpdate.mockReturnValue('v1.13.0+bbbbbbb2');
    const { result } = renderHook(() => useKioskUpdate(true));
    await flush();
    expect(result.current.prompting).toBe(false);
    act(() => result.current.checkNow(true));
    await flush();
    expect(result.current.prompting).toBe(true);
  });

  it('asks again on checkNow, and keeps the last answer when it cannot be had', async () => {
    const fetch = channel({ result: 'up-to-date', latest: 'v1.12.0+5a39e9a0' });
    const { result } = renderHook(() => useKioskUpdate(true));
    await flush();
    expect(result.current.newer).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);

    channel(NEWER);
    act(() => result.current.checkNow());
    await flush();
    expect(result.current.newer).toBe('v1.13.0 is out');

    // The internet or the service cannot be reached: the version already found stays.
    channel({ result: 'unreachable', latest: null });
    act(() => result.current.checkNow());
    await flush();
    expect(result.current.newer).toBe('v1.13.0 is out');
    channel(null);
    act(() => result.current.checkNow());
    await flush();
    expect(result.current.newer).toBe('v1.13.0 is out');
  });

  it('does nothing on checkNow off the kiosk', async () => {
    const { result } = renderHook(() => useKioskUpdate(false));
    act(() => result.current.checkNow());
    await flush();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores "Not now" until the service has said what is newer', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );
    const { result } = renderHook(() => useKioskUpdate(true));
    act(() => result.current.dismissPrompt());
    expect(kiosk.setDismissedUpdate).not.toHaveBeenCalled();
  });

  it('starting an update opens the console, stops the question and opens the update stream', async () => {
    const { result } = renderHook(() => useKioskUpdate(true));
    await flush();
    act(() => result.current.start());
    expect(latestFakeSocket().url).toBe('ws://127.0.0.1:7341/power/update');
    expect(result.current).toMatchObject({ isUpdating: true, consoleOpen: true, prompting: false, output: [] });
    act(() => result.current.closeConsole());
    expect(result.current.consoleOpen).toBe(false);
  });

  describe('while the update streams', () => {
    const begin = async () => {
      const hook = renderHook(() => useKioskUpdate(true));
      await flush();
      act(() => hook.result.current.start());
      act(() => latestFakeSocket().open());
      return hook;
    };

    it('collects the lines, writes each to the debug console, and ends when the kiosk says it is done', async () => {
      const { result } = await begin();
      act(() => latestFakeSocket().receive({ type: 'status', state: 'installing' }));
      act(() =>
        latestFakeSocket().receive({
          type: 'log',
          line: '2026-11-04T20:00:00+0000 kiosk-update[1]: Installing dev+bbbbbbb222'
        })
      );
      act(() => latestFakeSocket().receive({ type: 'error', line: 'No journal files were opened.' }));
      expect(result.current.output).toEqual([
        '2026-11-04T20:00:00+0000 kiosk-update[1]: Installing dev+bbbbbbb222',
        'No journal files were opened.'
      ]);
      expect(debug.debugLog.mock.calls).toEqual([
        ['info', 'update', '2026-11-04T20:00:00+0000 kiosk-update[1]: Installing dev+bbbbbbb222'],
        ['error', 'update', 'No journal files were opened.']
      ]);
      expect(result.current.isUpdating).toBe(true);

      act(() => latestFakeSocket().receive({ type: 'status', state: 'done', message: 'Nothing needed a restart.' }));
      act(() => latestFakeSocket().end());
      expect(result.current).toMatchObject({
        isUpdating: false,
        progress: 'Update finished. Nothing needed a restart.'
      });
    });

    it('keeps only the newest lines', async () => {
      const { result } = await begin();
      for (let line = 1; line <= 505; line++) {
        act(() => latestFakeSocket().receive({ type: 'log', line: `line ${line}` }));
      }
      expect(result.current.output).toHaveLength(500);
      expect(result.current.output[0]).toBe('line 6');
      expect(result.current.output.at(-1)).toBe('line 505');
    });

    it('says when the update failed', async () => {
      const { result } = await begin();
      act(() =>
        latestFakeSocket().receive({ type: 'status', state: 'failed', message: 'rauc install ended with status 1.' })
      );
      act(() => latestFakeSocket().end());
      expect(result.current).toMatchObject({
        isUpdating: false,
        progress: 'The update failed. rauc install ended with status 1.'
      });
    });

    it('is still updating when the connection ends in the restart: the page is about to go', async () => {
      const { result } = await begin();
      act(() => latestFakeSocket().receive({ type: 'status', state: 'restarting' }));
      expect(result.current.progress).toBe('Restarting the kiosk…');
      act(() => latestFakeSocket().end());
      expect(result.current).toMatchObject({ isUpdating: true, progress: 'Restarting the kiosk…' });
    });

    it('says when the connection was lost before the end, and when the service never answered', async () => {
      const lost = await begin();
      act(() => latestFakeSocket().end());
      expect(lost.result.current).toMatchObject({ isUpdating: false, progress: 'Lost the connection to the kiosk.' });

      const { result } = renderHook(() => useKioskUpdate(true));
      await flush();
      act(() => result.current.start());
      act(() => latestFakeSocket().end());
      expect(result.current).toMatchObject({ isUpdating: false, progress: 'The kiosk service is not answering.' });
    });

    it('starting again closes the earlier stream, and leaving closes the last', async () => {
      const { result, unmount } = await begin();
      const first = latestFakeSocket();
      act(() => result.current.start());
      expect(first.isClosed).toBe(true);
      expect(fakeSocketCount()).toBe(2);
      const second = latestFakeSocket();
      unmount();
      expect(second.isClosed).toBe(true);
    });

    it('gives up after twenty minutes and closes the stream', async () => {
      vi.useFakeTimers();
      const { result } = await begin();
      const socket = latestFakeSocket();
      await act(() => vi.advanceTimersByTimeAsync(20 * 60 * 1000 + 1000));
      expect(result.current.isUpdating).toBe(false);
      expect(result.current.progress).toBe('Stopped waiting for the update. It may still be running.');
      expect(socket.isClosed).toBe(true);
    });
  });

  it('says the percentage has stood still after a while, until it moves again', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useKioskUpdate(true));
      await act(() => vi.advanceTimersByTimeAsync(0));
      act(() => result.current.start());
      act(() => latestFakeSocket().open());
      act(() => latestFakeSocket().receive({ type: 'status', state: 'installing' }));
      act(() => latestFakeSocket().receive({ type: 'log', line: '… kiosk-update[1]: Update progress: 43% Checking' }));
      expect(result.current.isStalled).toBe(false);
      await act(() => vi.advanceTimersByTimeAsync(STALLED_AFTER_MS));
      expect(result.current).toMatchObject({ percent: 43, isStalled: true });
      act(() => latestFakeSocket().receive({ type: 'log', line: '… kiosk-update[1]: Update progress: 70% Copying' }));
      expect(result.current).toMatchObject({ percent: 70, isStalled: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('installs with a bar in percent, then waits for a restart', async () => {
    const { result } = renderHook(() => useKioskUpdate(true));
    await flush();
    act(() => result.current.start());
    act(() => latestFakeSocket().open());
    act(() => latestFakeSocket().receive({ type: 'status', state: 'installing' }));
    expect(result.current.progress).toBe('Installing the update…');
    act(() => latestFakeSocket().receive({ type: 'log', line: '… kiosk-update[1]: Update progress: 40% Copying' }));
    expect(result.current).toMatchObject({ percent: 40, output: [] });
    act(() => latestFakeSocket().receive({ type: 'status', state: 'installed', message: 'v1.13.0+bbbbbbb2' }));
    act(() => latestFakeSocket().end());
    expect(result.current).toMatchObject({
      isUpdating: false,
      installed: 'v1.13.0+bbbbbbb2',
      progress: 'v1.13.0 is installed.'
    });
  });
});
