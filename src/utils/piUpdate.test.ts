import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearDebugLog, getDebugEntries } from './debugLog';
import {
  describeUpdate,
  fetchUpdateStatus,
  getPiUpdate,
  installProgress,
  isActive,
  noteUpdateRequested,
  parseUpdateStatus,
  stopWatchingPiUpdates,
  subscribePiUpdate,
  UPDATE_STATUS_URL,
  watchPiUpdates,
  type UpdateStatus
} from './piUpdate';

const NOW = 1_800_000_000_000;

function status(fields: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    state: 'idle',
    ref: '',
    commit: '',
    started: NOW,
    updated: NOW,
    step: 0,
    total: 0,
    detail: '',
    ...fields
  };
}

/** The JSON the Pi serves: times in seconds. */
function served(fields: Partial<UpdateStatus>) {
  const value = status(fields);
  return { ...value, started: value.started / 1000, updated: value.updated / 1000 };
}

function answer(body: unknown) {
  return Promise.resolve(Response.json(body, { status: 200 }));
}

const messages = () => getDebugEntries().map(entry => `${entry.level} ${entry.message}`);

describe('parseUpdateStatus', () => {
  it('reads the service JSON, with times in ms', () => {
    expect(parseUpdateStatus(served({ state: 'installing', ref: 'v1.14.0', step: 3, total: 9 }))).toEqual(
      status({ state: 'installing', ref: 'v1.14.0', step: 3, total: 9 })
    );
  });

  it('refuses anything else and drops bad fields', () => {
    expect(parseUpdateStatus(null)).toBeNull();
    expect(parseUpdateStatus('installing')).toBeNull();
    expect(parseUpdateStatus({ state: 'rebooting' })).toBeNull();
    expect(parseUpdateStatus({ state: 'failed', step: -1, total: 1.5, detail: 7 })).toEqual(
      status({ state: 'failed', started: 0, updated: 0 })
    );
  });
});

describe('describeUpdate', () => {
  it.each([
    [status(), 'No update has run since the Pi started.'],
    [status({ state: 'checking' }), 'Checking GitHub for the latest version…'],
    [status({ state: 'downloading', ref: 'v2.0.0' }), 'Downloading v2.0.0…'],
    [status({ state: 'downloading' }), 'Downloading the update…'],
    [
      status({ state: 'installing', ref: 'v2.0.0', step: 12, total: 80, detail: 'Install Node.js' }),
      'Installing v2.0.0: step 12 of about 80 (Install Node.js)…'
    ],
    [status({ state: 'installing', ref: 'v2.0.0', step: 90, total: 80 }), 'Installing v2.0.0: step 80 of about 80…'],
    [status({ state: 'installing', ref: 'v2.0.0', step: 4 }), 'Installing v2.0.0: step 4…'],
    [status({ state: 'up-to-date', ref: 'v2.0.0' }), 'Already up to date (v2.0.0).'],
    [status({ state: 'up-to-date' }), 'Already up to date.'],
    [status({ state: 'installed', ref: 'v2.0.0' }), 'Installed v2.0.0.'],
    [status({ state: 'restart-needed', ref: 'v2.0.0' }), 'Installed v2.0.0. It applies when the kiosk restarts.'],
    [status({ state: 'failed', detail: 'No space left' }), 'Update failed: No space left'],
    [status({ state: 'failed' }), 'Update failed: no reason given.']
  ])('describes %o', (value, text) => {
    expect(describeUpdate(value)).toBe(text);
  });
});

describe('installProgress and isActive', () => {
  it('measures the install against the last run', () => {
    expect(installProgress(status({ state: 'installing', step: 20, total: 80 }))).toBe(0.25);
    expect(installProgress(status({ state: 'installing', step: 90, total: 80 }))).toBeCloseTo(0.99);
    expect(installProgress(status({ state: 'installing', step: 20 }))).toBeNull();
    expect(installProgress(status({ state: 'downloading', total: 80 }))).toBeNull();
  });

  it('treats a long silent run as dead', () => {
    expect(isActive(null)).toBe(false);
    expect(isActive(status({ state: 'checking' }), NOW + 1000)).toBe(true);
    expect(isActive(status({ state: 'installing' }), NOW + 36 * 60_000)).toBe(false);
    expect(isActive(status({ state: 'failed' }), NOW)).toBe(false);
  });
});

describe('fetchUpdateStatus', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks the loopback service', async () => {
    const fetchMock = vi.fn(() => answer(served({ state: 'checking' })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchUpdateStatus()).toEqual(status({ state: 'checking' }));
    expect(fetchMock).toHaveBeenCalledWith(UPDATE_STATUS_URL, { cache: 'no-store', signal: null });
  });

  it('throws on an error or an unexpected answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 404 })))
    );
    await expect(fetchUpdateStatus()).rejects.toThrow('HTTP 404');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => answer({ state: 'nope' }))
    );
    await expect(fetchUpdateStatus()).rejects.toThrow('Unexpected answer');
  });
});

describe('watchPiUpdates', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    clearDebugLog();
  });
  afterEach(() => {
    stopWatchingPiUpdates();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('follows a run and logs each step to the debug console', async () => {
    const answers = [
      served({ state: 'up-to-date', ref: 'v1.13.0', started: NOW - 3_600_000, updated: NOW - 3_600_000 }),
      served({ state: 'checking' }),
      served({ state: 'downloading', ref: 'v1.14.0' }),
      served({ state: 'installing', ref: 'v1.14.0', step: 1, total: 2, detail: 'Gathering Facts' }),
      served({ state: 'installing', ref: 'v1.14.0', step: 1, total: 2, detail: 'Gathering Facts' }),
      served({ state: 'restart-needed', ref: 'v1.14.0' })
    ];
    const fetchMock = vi.fn(() => answer(answers.shift() ?? served({ state: 'restart-needed', ref: 'v1.14.0' })));
    vi.stubGlobal('fetch', fetchMock);
    const listener = vi.fn();
    const unsubscribe = subscribePiUpdate(listener);

    watchPiUpdates();
    watchPiUpdates();
    await vi.advanceTimersByTimeAsync(0);
    expect(getPiUpdate()).toMatchObject({ reachable: true, status: { state: 'up-to-date' } });
    expect(listener).toHaveBeenCalled();

    noteUpdateRequested();
    expect(getPiUpdate().requestedAt).toBe(NOW);
    await vi.advanceTimersByTimeAsync(5000);
    expect(getPiUpdate().status?.state).toBe('restart-needed');
    expect(messages()).toEqual([
      expect.stringMatching(/^info Last update run \(\d\d:\d\d\): Already up to date \(v1\.13\.0\)\.$/),
      'info Asked the Pi to update now',
      'info Checking GitHub for the latest version…',
      'info Downloading v1.14.0…',
      'info Installing v1.14.0: step 1 of about 2 (Gathering Facts)…',
      'info Installed v1.14.0. It applies when the kiosk restarts.'
    ]);
    unsubscribe();
  });

  it('logs a failure as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => answer(served({ state: 'failed', detail: 'GitHub is down' })))
    );
    watchPiUpdates();
    await vi.advanceTimersByTimeAsync(0);
    expect(messages()).toEqual([expect.stringMatching(/^error Last update run .*: Update failed: GitHub is down$/)]);
  });

  it('says once that an older kiosk image has no status, and asks again slowly', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);
    watchPiUpdates();
    await vi.advanceTimersByTimeAsync(0);
    expect(getPiUpdate().reachable).toBe(false);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(messages()).toEqual(["warn Cannot see the Pi's update progress: Failed to fetch"]);
  });

  it('only records a tap when it is not watching', () => {
    vi.stubGlobal('fetch', vi.fn());
    noteUpdateRequested();
    expect(getPiUpdate().requestedAt).toBe(NOW);
    expect(fetch).not.toHaveBeenCalled();
  });
});
