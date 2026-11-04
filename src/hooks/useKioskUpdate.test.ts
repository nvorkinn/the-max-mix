import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { FakeWebSocket, fakeSocketCount, latestFakeSocket, resetFakeSockets } from '../test/fakeWebSocket';
import { useKioskUpdate } from './useKioskUpdate';

const kiosk = vi.hoisted(() => ({
  piVersion: vi.fn(),
  latestCommit: vi.fn(),
  latestRelease: vi.fn(),
  isRelease: (ref: string) => /^v\d/.test(ref),
  getDismissedUpdate: vi.fn(),
  setDismissedUpdate: vi.fn()
}));
vi.mock('../utils/kiosk', () => kiosk);
const debug = vi.hoisted(() => ({ debugLog: vi.fn() }));
vi.mock('../utils/debugLog', () => debug);

const flush = () => act(async () => {});

describe('useKioskUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeSockets();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    kiosk.piVersion.mockReturnValue({ ref: 'v1.12.0', commit: '5a39e9a' });
    kiosk.getDismissedUpdate.mockReturnValue(null);
    kiosk.latestRelease.mockResolvedValue('v1.13.0');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('asks about a newer version, and not before GitHub has answered', async () => {
    const { result } = renderHook(() => useKioskUpdate(true));
    expect(result.current.prompting).toBe(false);
    await flush();
    expect(result.current.newer).toBe('v1.13.0 is out');
    expect(result.current.prompting).toBe(true);
  });

  it('does not ask when up to date, when GitHub cannot be asked, or off the kiosk', async () => {
    kiosk.latestRelease.mockResolvedValue('v1.12.0');
    const upToDate = renderHook(() => useKioskUpdate(true));
    await flush();
    expect(upToDate.result.current).toMatchObject({ newer: null, prompting: false });

    kiosk.latestRelease.mockResolvedValue(null);
    const unknown = renderHook(() => useKioskUpdate(true));
    await flush();
    expect(unknown.result.current).toMatchObject({ newer: null, prompting: false });

    kiosk.latestRelease.mockResolvedValue('v1.13.0');
    const off = renderHook(() => useKioskUpdate(false));
    await flush();
    expect(off.result.current).toMatchObject({ version: null, newer: null, prompting: false });
  });

  it('remembers "Not now" for that version only', async () => {
    const { result, rerender } = renderHook(() => useKioskUpdate(true));
    await flush();
    act(() => result.current.dismissPrompt());
    expect(kiosk.setDismissedUpdate).toHaveBeenCalledWith('v1.13.0');
    expect(result.current.prompting).toBe(false);
    // The settings still say a newer version is out.
    expect(result.current.newer).toBe('v1.13.0 is out');
    rerender();

    // Another visit: the stored answer is for the same version, so no question; a newer one asks again.
    kiosk.getDismissedUpdate.mockReturnValue('v1.13.0');
    const again = renderHook(() => useKioskUpdate(true));
    await flush();
    expect(again.result.current.prompting).toBe(false);
    kiosk.latestRelease.mockResolvedValue('v1.14.0');
    const newest = renderHook(() => useKioskUpdate(true));
    await flush();
    expect(newest.result.current.prompting).toBe(true);
  });

  it('asks GitHub again on checkNow, and keeps the last answer when it cannot be had', async () => {
    kiosk.latestRelease.mockResolvedValue('v1.12.0');
    const { result } = renderHook(() => useKioskUpdate(true));
    await flush();
    expect(result.current.newer).toBeNull();
    expect(kiosk.latestRelease).toHaveBeenCalledTimes(1);

    kiosk.latestRelease.mockResolvedValue('v1.13.0');
    act(() => result.current.checkNow());
    await flush();
    expect(kiosk.latestRelease).toHaveBeenCalledTimes(2);
    expect(result.current.newer).toBe('v1.13.0 is out');

    // GitHub cannot be asked (offline, rate limited): the version already found stays.
    kiosk.latestRelease.mockResolvedValue(null);
    act(() => result.current.checkNow());
    await flush();
    expect(kiosk.latestRelease).toHaveBeenCalledTimes(3);
    expect(result.current.newer).toBe('v1.13.0 is out');
  });

  it('does nothing on checkNow off the kiosk', async () => {
    const { result } = renderHook(() => useKioskUpdate(false));
    act(() => result.current.checkNow());
    await flush();
    expect(kiosk.latestRelease).not.toHaveBeenCalled();
  });

  it('ignores "Not now" until GitHub has said what is newer', () => {
    kiosk.latestRelease.mockReturnValue(new Promise(() => {}));
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
      act(() => latestFakeSocket().receive({ type: 'status', state: 'pulling' }));
      act(() =>
        latestFakeSocket().receive({ type: 'log', line: '2026-11-04T20:00:00+0000 kiosk-pull[1]: TASK [kiosk]' })
      );
      act(() => latestFakeSocket().receive({ type: 'error', line: 'No journal files were opened.' }));
      expect(result.current.output).toEqual([
        '2026-11-04T20:00:00+0000 kiosk-pull[1]: TASK [kiosk]',
        'No journal files were opened.'
      ]);
      expect(debug.debugLog.mock.calls).toEqual([
        ['info', 'update', '2026-11-04T20:00:00+0000 kiosk-pull[1]: TASK [kiosk]'],
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
        latestFakeSocket().receive({ type: 'status', state: 'failed', message: 'The pull ended with status 1.' })
      );
      act(() => latestFakeSocket().end());
      expect(result.current).toMatchObject({
        isUpdating: false,
        progress: 'The update failed. The pull ended with status 1.'
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
});
