import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLingers } from './useLingers';

const LINGER_MS = 30_000;

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useLingers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts off when off', () => {
    const { result } = renderHook(() => useLingers(false, LINGER_MS));
    expect(result.current).toBe(false);
  });

  it('stays on for the linger after it turns off, then turns off', () => {
    const { result, rerender } = renderHook(({ on }) => useLingers(on, LINGER_MS), { initialProps: { on: true } });
    rerender({ on: false });
    advance(LINGER_MS - 1);
    expect(result.current).toBe(true);
    advance(1);
    expect(result.current).toBe(false);
  });

  it('turning on again within the linger keeps it on and starts the linger over', () => {
    const { result, rerender } = renderHook(({ on }) => useLingers(on, LINGER_MS), { initialProps: { on: true } });
    rerender({ on: false });
    advance(LINGER_MS - 1000);
    rerender({ on: true });
    rerender({ on: false });
    advance(LINGER_MS - 1);
    expect(result.current).toBe(true);
    advance(1);
    expect(result.current).toBe(false);
  });
});
