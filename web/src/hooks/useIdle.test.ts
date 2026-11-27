import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIdle } from './useIdle';

const IDLE_MS = 2 * 60_000;

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useIdle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onIdle once nobody has touched the screen for the idle time, and a touch starts it again', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdle({ enabled: true, busy: false, idleMs: IDLE_MS, onIdle }));
    advance(IDLE_MS - 1000);
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    advance(IDLE_MS - 1000);
    expect(onIdle).not.toHaveBeenCalled();
    advance(1000);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('waits while music plays, and counts from when it stops', () => {
    const onIdle = vi.fn();
    const { rerender } = renderHook(({ busy }) => useIdle({ enabled: true, busy, idleMs: IDLE_MS, onIdle }), {
      initialProps: { busy: true }
    });
    advance(IDLE_MS * 3);
    expect(onIdle).not.toHaveBeenCalled();
    rerender({ busy: false });
    advance(IDLE_MS);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('does nothing when not enabled', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdle({ enabled: false, busy: false, idleMs: IDLE_MS, onIdle }));
    advance(IDLE_MS * 3);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
