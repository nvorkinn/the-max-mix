import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchSoloistAuth } from '../spotify/soloistSignIn';
import type { SoloistAuth } from '../spotify/soloistSignIn';
import { SIGNED_OUT_AFTER_MS, useSoloistSignIn } from './useSoloistSignIn';

vi.mock('../spotify/soloistSignIn', () => ({ watchSoloistAuth: vi.fn() }));

const NAME = 'The Max Mix 4';
const UNKNOWN = { isSignedIn: null, deviceName: null };

/** Soloist as the hook watches it: `says` is Soloist saying where its sign-in stands. */
function soloist() {
  const stop = vi.fn();
  let tell: ((auth: SoloistAuth) => void) | undefined;
  vi.mocked(watchSoloistAuth).mockImplementation(onAuth => {
    tell = onAuth;
    return stop;
  });
  return { stop, says: (isSignedIn: boolean) => act(() => tell?.({ isSignedIn, deviceName: NAME })) };
}

/** Lets `ms` pass. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useSoloistSignIn', () => {
  it('knows nothing, and does not watch, until asked to', () => {
    soloist();
    const { result } = renderHook(() => useSoloistSignIn(false));
    expect(result.current).toEqual(UNKNOWN);
    expect(watchSoloistAuth).not.toHaveBeenCalled();
  });

  it('says Soloist is signed in as soon as it says so', () => {
    const { says } = soloist();
    const { result } = renderHook(() => useSoloistSignIn(true));
    expect(result.current).toEqual(UNKNOWN);
    says(true);
    expect(result.current).toEqual({ isSignedIn: true, deviceName: NAME });
  });

  it('takes a sign-out as one only once it has lasted', () => {
    const { says } = soloist();
    const { result } = renderHook(() => useSoloistSignIn(true));
    says(false);
    advance(SIGNED_OUT_AFTER_MS - 1);
    expect(result.current).toEqual(UNKNOWN);
    advance(1);
    expect(result.current).toEqual({ isSignedIn: false, deviceName: NAME });
  });

  it('passes over the sign-out Soloist reports as it starts, before it restores the session', () => {
    const { says } = soloist();
    const { result } = renderHook(() => useSoloistSignIn(true));
    says(false);
    says(true);
    advance(SIGNED_OUT_AFTER_MS);
    expect(result.current).toEqual({ isSignedIn: true, deviceName: NAME });
  });

  it('stops watching, and drops a sign-out it was waiting on, once no longer asked to', () => {
    const { says, stop } = soloist();
    const { result, rerender } = renderHook(({ isWatching }) => useSoloistSignIn(isWatching), {
      initialProps: { isWatching: true }
    });
    says(false);
    rerender({ isWatching: false });
    expect(stop).toHaveBeenCalledOnce();
    advance(SIGNED_OUT_AFTER_MS);
    expect(result.current).toEqual(UNKNOWN);
  });
});
