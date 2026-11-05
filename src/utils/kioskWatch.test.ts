import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDebugLog, debugLog } from './debugLog';
import { HEARTBEAT_MS, startKioskWatch } from './kioskWatch';

describe('startKioskWatch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let stop: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    clearDebugLog();
    document.body.innerHTML = '<div id="root"></div>';
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const paths = () => fetchMock.mock.calls.map(([url]) => String(url));

  it('sends a heartbeat while the app shows something', () => {
    stop = startKioskWatch();
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(paths()).toEqual([]);
    document.querySelector('#root')?.append(document.createElement('main'));
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/heartbeat', { method: 'POST' });
  });

  it('copies each error once, including the ones from before it started, and nothing else', () => {
    debugLog('error', 'page', 'early');
    debugLog('warn', 'console', 'just a warning');
    stop = startKioskWatch();
    debugLog('error', 'player', 'later');
    debugLog('error', 'player', 'later');
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string) as unknown);
    expect(paths()).toEqual(['http://127.0.0.1:7341/log', 'http://127.0.0.1:7341/log']);
    expect(bodies).toEqual([
      { level: 'error', source: 'page', message: 'early' },
      { level: 'error', source: 'player', message: 'later' }
    ]);
  });

  it('stays quiet when the kiosk service does not answer', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    stop = startKioskWatch();
    debugLog('error', 'page', 'boom');
    await vi.runOnlyPendingTimersAsync();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
