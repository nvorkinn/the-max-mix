import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenSleep } from './useScreenSleep';

const screenSleep = vi.hoisted(() => ({ wakeDisplay: vi.fn() }));
vi.mock('../utils/screenSleep', () => screenSleep);

const IDLE_MS = 5 * 60_000;

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

interface Props {
  enabled: boolean;
  keepAwake: boolean;
  idleMs: number | null;
}

function renderSleep(props: Partial<Props> = {}) {
  return renderHook((p: Props) => useScreenSleep(p), {
    initialProps: { enabled: true, keepAwake: false, idleMs: IDLE_MS, ...props }
  });
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

  it('sleeps after the idle time with nothing playing', () => {
    const { result } = renderSleep();
    advance(IDLE_MS - 1);
    expect(result.current.asleep).toBe(false);
    advance(1);
    expect(result.current.asleep).toBe(true);
  });

  it('starts the countdown again at every touch', () => {
    const { result } = renderSleep();
    advance(IDLE_MS - 1000);
    touch();
    advance(IDLE_MS - 1000);
    expect(result.current.asleep).toBe(false);
    advance(1000);
    expect(result.current.asleep).toBe(true);
  });

  it('stays awake while music plays and counts down from when it stops', () => {
    const { result, rerender } = renderSleep({ keepAwake: true });
    advance(IDLE_MS * 3);
    expect(result.current.asleep).toBe(false);
    rerender({ enabled: true, keepAwake: false, idleMs: IDLE_MS });
    advance(IDLE_MS - 1);
    expect(result.current.asleep).toBe(false);
    advance(1);
    expect(result.current.asleep).toBe(true);
  });

  it('a touch while asleep does not wake it by itself, so the sleep screen catches the tap', () => {
    const { result } = renderSleep();
    advance(IDLE_MS);
    touch();
    expect(result.current.asleep).toBe(true);
    act(() => {
      result.current.wake();
    });
    expect(result.current.asleep).toBe(false);
    advance(IDLE_MS);
    expect(result.current.asleep).toBe(true);
  });

  it('a key press wakes it', () => {
    const { result } = renderSleep();
    advance(IDLE_MS);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });
    expect(result.current.asleep).toBe(false);
  });

  it('music that starts while asleep wakes it and turns the Pi screen on', () => {
    const { result, rerender } = renderSleep();
    advance(IDLE_MS);
    expect(result.current.asleep).toBe(true);
    rerender({ enabled: true, keepAwake: true, idleMs: IDLE_MS });
    expect(result.current.asleep).toBe(false);
    expect(screenSleep.wakeDisplay).toHaveBeenCalledTimes(1);
  });

  it('never sleeps when the delay is off', () => {
    const { result } = renderSleep({ idleMs: null });
    advance(IDLE_MS * 100);
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
      await vi.advanceTimersByTimeAsync(IDLE_MS);
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
});
