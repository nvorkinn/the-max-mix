import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useKioskUpdate } from './useKioskUpdate';

const kiosk = vi.hoisted(() => ({
  piVersion: vi.fn(),
  latestCommit: vi.fn(),
  latestRelease: vi.fn(),
  isRelease: (ref: string) => /^v\d/.test(ref),
  updateKiosk: vi.fn(),
  getDismissedUpdate: vi.fn(),
  setDismissedUpdate: vi.fn()
}));
vi.mock('../utils/kiosk', () => kiosk);
const service = vi.hoisted(() => ({ getUpdateStatus: vi.fn() }));
vi.mock('../utils/kioskService', () => service);
vi.mock('../utils/debugLog', () => ({ debugLog: vi.fn() }));

const flush = () => act(async () => {});

describe('useKioskUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kiosk.piVersion.mockReturnValue({ ref: 'v1.12.0', commit: '5a39e9a' });
    kiosk.getDismissedUpdate.mockReturnValue(null);
    kiosk.latestRelease.mockResolvedValue('v1.13.0');
  });
  afterEach(() => vi.useRealTimers());

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

  it('ignores "Not now" until GitHub has said what is newer', () => {
    kiosk.latestRelease.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useKioskUpdate(true));
    act(() => result.current.dismissPrompt());
    expect(kiosk.setDismissedUpdate).not.toHaveBeenCalled();
  });

  it('starting an update opens the console, stops the question and asks the kiosk', async () => {
    service.getUpdateStatus.mockResolvedValue(null);
    const { result } = renderHook(() => useKioskUpdate(true));
    await flush();
    act(() => result.current.start());
    expect(kiosk.updateKiosk).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ isUpdating: true, consoleOpen: true, prompting: false, output: [] });
    act(() => result.current.closeConsole());
    expect(result.current.consoleOpen).toBe(false);
  });

  it('gives up following an update after twenty minutes', async () => {
    vi.useFakeTimers();
    service.getUpdateStatus.mockResolvedValue({ state: 'running', lines: ['TASK'], total: 1 });
    const { result } = renderHook(() => useKioskUpdate(true));
    await flush();
    act(() => result.current.start());
    await act(() => vi.advanceTimersByTimeAsync(20 * 60 * 1000 + 3000));
    expect(result.current.isUpdating).toBe(false);
    expect(result.current.progress).toBe('Stopped waiting for the update. It may still be running.');
  });
});
