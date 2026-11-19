import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DIM_AFTER_MS, QUIET_SLEEP_MS, startNextAsleep, useScreenSleep } from './useScreenSleep';

const screenSleep = vi.hoisted(() => ({ wakeDisplay: vi.fn() }));
vi.mock('../utils/screenSleep', () => screenSleep);

// The sleep delay chosen in Settings, counted from the moment the Dashboard dims.
const SLEEP_MS = 5 * 60_000;
// Untouched on the Dashboard, from the last touch to sleep.
const IDLE_MS = DIM_AFTER_MS + SLEEP_MS;

/** A fake navigator.wakeLock that records the locks it hands out. */
function fakeWakeLock() {
  const locks: (EventTarget & { released: boolean; release: () => Promise<void> })[] = [];
  const request = vi.fn(() => {
    const lock = Object.assign(new EventTarget(), {
      released: false,
      release: vi.fn(() => {
        lock.released = true;
        lock.dispatchEvent(new Event('release'));
        return Promise.resolve();
      })
    });
    locks.push(lock);
    return Promise.resolve(lock);
  });
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
  return { request, locks };
}

function touch() {
  act(() => {
    window.dispatchEvent(new Event('pointerdown'));
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Untouched on the Dashboard from awake: it dims, and then sleeps. */
function advanceToSleep() {
  advance(DIM_AFTER_MS);
  advance(SLEEP_MS);
}

interface Props {
  enabled: boolean;
  keepAwake: boolean;
  onDashboard: boolean;
  sleepMs: number | null;
  quiet: boolean;
}

const DEFAULTS: Props = { enabled: true, keepAwake: false, onDashboard: true, sleepMs: SLEEP_MS, quiet: false };

function renderSleep(props: Partial<Props> = {}) {
  const hook = renderHook((p: Props) => useScreenSleep(p), { initialProps: { ...DEFAULTS, ...props } });
  return { ...hook, rerender: (next: Partial<Props>) => hook.rerender({ ...DEFAULTS, ...next }) };
}

describe('useScreenSleep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, 'wakeLock');
  });

  it('dims the Dashboard after five untouched minutes, then sleeps the chosen delay later', () => {
    const { result } = renderSleep();
    advance(DIM_AFTER_MS - 1);
    expect(result.current.dimmed).toBe(false);
    advance(1);
    expect(result.current.dimmed).toBe(true);
    expect(result.current.asleep).toBe(false);
    advance(SLEEP_MS - 1);
    expect(result.current.asleep).toBe(false);
    advance(1);
    expect(result.current.asleep).toBe(true);
    expect(result.current.dimmed).toBe(false);
  });

  it('a touch while dimmed does not brighten it by itself, so the overlay catches the tap; wake starts over', () => {
    const { result } = renderSleep();
    advance(DIM_AFTER_MS);
    touch();
    expect(result.current.dimmed).toBe(true);
    act(() => {
      result.current.wake();
    });
    expect(result.current.dimmed).toBe(false);
    advance(DIM_AFTER_MS - 1);
    expect(result.current.dimmed).toBe(false);
    advance(1);
    expect(result.current.dimmed).toBe(true);
  });

  it('music that starts while dimmed brightens the screen without asking the Pi', () => {
    const { result, rerender } = renderSleep();
    advance(DIM_AFTER_MS);
    rerender({ keepAwake: true });
    expect(result.current.dimmed).toBe(false);
    advance(IDLE_MS * 3);
    expect(result.current.dimmed).toBe(false);
    expect(screenSleep.wakeDisplay).not.toHaveBeenCalled();
  });

  it('neither dims nor sleeps on another tab', () => {
    const { result, rerender } = renderSleep({ onDashboard: false });
    advance(IDLE_MS * 3);
    expect(result.current.dimmed).toBe(false);
    expect(result.current.asleep).toBe(false);
    rerender({ onDashboard: true });
    advance(DIM_AFTER_MS);
    expect(result.current.dimmed).toBe(true);
  });

  it('in quiet hours sleeps a minute after the last touch, on any tab', () => {
    const { result } = renderSleep({ onDashboard: false, quiet: true });
    advance(QUIET_SLEEP_MS - 1000);
    touch();
    advance(QUIET_SLEEP_MS - 1);
    expect(result.current.asleep).toBe(false);
    advance(1);
    expect(result.current.asleep).toBe(true);
  });

  it('quiet hours beginning while dimmed send the screen to sleep a minute later, delay or not', () => {
    const { result, rerender } = renderSleep({ sleepMs: null });
    advance(DIM_AFTER_MS);
    expect(result.current.dimmed).toBe(true);
    rerender({ sleepMs: null, quiet: true });
    advance(QUIET_SLEEP_MS);
    expect(result.current.asleep).toBe(true);
  });

  it('music keeps the screen on in quiet hours too', () => {
    const { result } = renderSleep({ keepAwake: true, quiet: true });
    advance(QUIET_SLEEP_MS * 30);
    expect(result.current.asleep).toBe(false);
  });

  it('starts the countdown again at every touch', () => {
    const { result } = renderSleep();
    advance(DIM_AFTER_MS - 1000);
    touch();
    advance(DIM_AFTER_MS - 1000);
    expect(result.current.dimmed).toBe(false);
    advance(1000);
    expect(result.current.dimmed).toBe(true);
  });

  it('stays awake while music plays and counts down from when it stops', () => {
    const { result, rerender } = renderSleep({ keepAwake: true });
    advance(IDLE_MS * 3);
    expect(result.current.dimmed).toBe(false);
    expect(result.current.asleep).toBe(false);
    rerender({ keepAwake: false });
    advance(DIM_AFTER_MS - 1);
    expect(result.current.dimmed).toBe(false);
    advance(1);
    expect(result.current.dimmed).toBe(true);
    advance(SLEEP_MS);
    expect(result.current.asleep).toBe(true);
  });

  it('a touch while asleep does not wake it by itself, so the sleep screen catches the tap', () => {
    const { result } = renderSleep();
    advanceToSleep();
    touch();
    expect(result.current.asleep).toBe(true);
    act(() => {
      result.current.wake();
    });
    expect(result.current.asleep).toBe(false);
    advanceToSleep();
    expect(result.current.asleep).toBe(true);
  });

  it('a key press wakes it', () => {
    const { result } = renderSleep();
    advanceToSleep();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });
    expect(result.current.asleep).toBe(false);
  });

  it('music that starts while asleep wakes it and turns the Pi screen on', () => {
    const { result, rerender } = renderSleep();
    advanceToSleep();
    expect(result.current.asleep).toBe(true);
    rerender({ keepAwake: true });
    expect(result.current.asleep).toBe(false);
    expect(screenSleep.wakeDisplay).toHaveBeenCalledTimes(1);
  });

  it('dims when the delay is off, and never sleeps', () => {
    const { result } = renderSleep({ sleepMs: null });
    advance(IDLE_MS * 100);
    expect(result.current.dimmed).toBe(true);
    expect(result.current.asleep).toBe(false);
  });

  it('does nothing off the kiosk', async () => {
    const { request } = fakeWakeLock();
    const { result } = renderSleep({ enabled: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_MS);
    });
    expect(result.current.asleep).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('holds a screen wake lock while awake and lets go while asleep', async () => {
    const { request, locks } = fakeWakeLock();
    const { result } = renderSleep();
    await act(async () => {
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledWith('screen');
    expect(result.current.wakeLock).toBe('held');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DIM_AFTER_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLEEP_MS);
    });
    expect(result.current.asleep).toBe(true);
    expect(locks[0]?.released).toBe(true);
    expect(result.current.wakeLock).toBe('released');
    await act(async () => {
      result.current.wake();
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.current.wakeLock).toBe('held');
  });

  it('says when the browser has no wake lock', () => {
    const { result } = renderSleep();
    expect(result.current.wakeLock).toBe('unsupported');
  });

  it('starts asleep once after a switch made while it slept', () => {
    startNextAsleep();
    expect(renderSleep().result.current.asleep).toBe(true);
    expect(renderSleep().result.current.asleep).toBe(false);
  });
});
