import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PiSonosNow } from '../sonos/kiosk';

const pi = vi.hoisted(() => ({
  getSonosNow: vi.fn<(room: string) => Promise<PiSonosNow>>(),
  setSonosVolume: vi.fn<(room: string, volume: number) => Promise<void>>(),
  watchSonosOnPi: vi.fn<(onChange: (change: 'groups' | 'now') => void) => () => void>()
}));
vi.mock('../sonos/kiosk', async original => ({
  ...(await original<typeof import('../sonos/kiosk')>()),
  ...pi
}));

const { useAlongVolume } = await import('./useAlongVolume');

const nowAt = (volume: number | null) => Promise.resolve({ volume } as PiSonosNow);

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useAlongVolume', () => {
  it("reads the rooms' volume, again when it changes, and has none without a room", async () => {
    let tell: (change: 'groups' | 'now') => void = () => {};
    const stop = vi.fn<() => void>();
    pi.watchSonosOnPi.mockImplementation(onChange => {
      tell = onChange;
      return stop;
    });
    pi.getSonosNow.mockReturnValueOnce(nowAt(12)).mockReturnValueOnce(nowAt(20));
    const { result, rerender } = renderHook(({ room }: { room: string | null }) => useAlongVolume(room), {
      initialProps: { room: 'Kitchen' as string | null }
    });
    await waitFor(() => expect(result.current.volume).toBe(12));
    act(() => tell('now'));
    await waitFor(() => expect(result.current.volume).toBe(20));
    expect(pi.getSonosNow).toHaveBeenCalledWith('Kitchen');
    rerender({ room: null });
    expect(result.current.volume).toBeNull();
    expect(stop).toHaveBeenCalled();
  });

  it('sets the volume once the slider rests, and keeps going when the speakers fail', async () => {
    vi.useFakeTimers();
    pi.watchSonosOnPi.mockReturnValue(() => {});
    pi.getSonosNow.mockRejectedValue(new Error('no answer'));
    pi.setSonosVolume.mockRejectedValue(new Error('no answer'));
    const { result } = renderHook(() => useAlongVolume('Kitchen'));
    act(() => {
      result.current.setVolume(30);
      result.current.setVolume(40);
    });
    expect(result.current.volume).toBe(40);
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(pi.setSonosVolume).toHaveBeenCalledTimes(1);
    expect(pi.setSonosVolume).toHaveBeenCalledWith('Kitchen', 40);
  });
});
