import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PiSonosNow } from '../sonos/kiosk';
import { deferred } from '../test/deferred';

const pi = vi.hoisted(() => ({
  findSonosOnPi: vi.fn(),
  getSonosNow: vi.fn(),
  getSonosArt: vi.fn(),
  controlSonos: vi.fn(),
  moveSonosSong: vi.fn(),
  setSonosVolume: vi.fn(),
  playOnSonosRoom: vi.fn(),
  watchSonosOnPi: vi.fn()
}));
/** What the hook gave watchSonosOnPi: how to tell it the speakers changed, and that the Pi's stream is live. */
const watching = vi.hoisted(() => ({
  change: vi.fn<(change: 'groups' | 'now') => void>(),
  live: vi.fn<(live: boolean) => void>()
}));
vi.mock('../sonos/kiosk', async original => ({
  ...(await original<typeof import('../sonos/kiosk')>()),
  ...pi
}));

const { setKioskSonosLeader, getKioskSonosLeader } = await import('../sonos/kiosk');
const { useSonosPlayer } = await import('./useSonosPlayer');

const GROUPS = {
  groups: [
    {
      id: 'g1',
      rooms: [
        { id: 'p1', name: 'Kitchen' },
        { id: 'p2', name: 'Lounge' }
      ]
    }
  ],
  ms: 800
};
const URI = 'spotify:track:1234567890123456789012';
const NOW: PiSonosNow = {
  playing: true,
  positionMs: 30_000,
  track: { name: 'Song', artist: 'Band', durationMs: 200_000, uri: URI, art: true },
  next: [{ name: 'Next', artist: 'Band', uri: 'spotify:track:abcdefghijklmnopqrstuv' }, { name: 'Radio' }],
  volume: 40,
  canSeek: false
};

describe('useSonosPlayer', () => {
  beforeEach(() => {
    pi.findSonosOnPi.mockReset().mockResolvedValue(GROUPS);
    pi.getSonosNow.mockReset().mockResolvedValue(NOW);
    pi.getSonosArt.mockReset().mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    pi.controlSonos.mockReset().mockResolvedValue(undefined);
    pi.moveSonosSong.mockReset().mockResolvedValue(undefined);
    pi.setSonosVolume.mockReset().mockResolvedValue(undefined);
    pi.playOnSonosRoom.mockReset().mockResolvedValue(undefined);
    pi.watchSonosOnPi
      .mockReset()
      .mockImplementation((onChange: typeof watching.change, onLive: typeof watching.live) => {
        watching.change = onChange;
        watching.live = onLive;
        return vi.fn();
      });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:art'), revokeObjectURL: vi.fn() }));
  });

  afterEach(() => {
    act(() => setKioskSonosLeader(null));
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const follow = async () => {
    const hook = renderHook(() => useSonosPlayer());
    act(() => setKioskSonosLeader('Kitchen'));
    await waitFor(() => expect(hook.result.current.playback).not.toBeNull());
    return hook;
  };

  it('follows nothing until the kiosk plays on a Sonos', () => {
    const { result } = renderHook(() => useSonosPlayer());
    expect(result.current).toMatchObject({ active: false, playback: null, name: null, next: [] });
    expect(pi.findSonosOnPi).not.toHaveBeenCalled();
  });

  it('shows the group the kiosk plays on as the player: its song, artwork, volume and controls', async () => {
    const { result } = await follow();
    await waitFor(() => expect(result.current.playback?.item?.album?.images).toEqual([{ url: 'blob:art' }]));
    expect(result.current.active).toBe(true);
    expect(result.current.name).toBe('Kitchen + 1');
    expect(result.current.playback).toMatchObject({
      is_playing: true,
      device: { id: 'sonos:Kitchen', name: 'Kitchen + 1', volume_percent: 40, supports_volume: true },
      item: {
        id: '1234567890123456789012',
        uri: URI,
        name: 'Song',
        artists: [{ name: 'Band' }],
        duration_ms: 200_000
      },
      actions: { disallows: { seeking: true, toggling_shuffle: true } }
    });
    expect(result.current.playback?.progress_ms).toBeGreaterThanOrEqual(30_000);
    expect(pi.getSonosNow).toHaveBeenCalledWith('Kitchen');
    expect(pi.getSonosArt).toHaveBeenCalledWith('Kitchen');
    // What the group's Sonos queue plays next.
    expect(result.current.next).toEqual([
      {
        id: 'abcdefghijklmnopqrstuv',
        uri: 'spotify:track:abcdefghijklmnopqrstuv',
        name: 'Next',
        artists: [{ name: 'Band' }]
      },
      { name: 'Radio', artists: [] }
    ]);
  });

  it('shows a song with no details, and no volume, as the Sonos says', async () => {
    pi.getSonosNow.mockResolvedValue({
      playing: false,
      positionMs: 0,
      track: { name: 'Radio', art: false },
      next: [],
      volume: null,
      canSeek: true
    });
    const { result } = await follow();
    expect(result.current.playback).toMatchObject({
      is_playing: false,
      progress_ms: 0,
      device: { volume_percent: null, supports_volume: false },
      item: { name: 'Radio', artists: [], album: { images: [] } },
      actions: { disallows: { seeking: false } }
    });
    expect(pi.getSonosArt).not.toHaveBeenCalled();
  });

  it('pauses, plays, skips and seeks on the group', async () => {
    const { result } = await follow();
    await act(() => result.current.togglePlay());
    expect(pi.controlSonos).toHaveBeenLastCalledWith('Kitchen', 'pause', undefined);
    expect(result.current.playback?.is_playing).toBe(false);
    await act(() => result.current.togglePlay());
    expect(pi.controlSonos).toHaveBeenLastCalledWith('Kitchen', 'play', undefined);
    await act(() => result.current.nextTrack());
    expect(pi.controlSonos).toHaveBeenLastCalledWith('Kitchen', 'next', undefined);
    await act(() => result.current.previousTrack());
    expect(pi.controlSonos).toHaveBeenLastCalledWith('Kitchen', 'previous', undefined);
    await act(() => result.current.seek(90_000));
    expect(pi.controlSonos).toHaveBeenLastCalledWith('Kitchen', 'seek', 90_000);
    pi.controlSonos.mockClear();
    await act(() => result.current.skipAhead(2));
    expect(pi.controlSonos.mock.calls).toEqual([
      ['Kitchen', 'next'],
      ['Kitchen', 'next']
    ]);
  });

  it('moves a queued song on the Sonos, showing the new order at once', async () => {
    const { result } = await follow();
    await act(() => result.current.moveSong(1, 0));
    expect(pi.moveSonosSong).toHaveBeenCalledWith('Kitchen', 1, 0, 'Radio');
    expect(result.current.next.map(track => track.name)).toEqual(['Radio', 'Next']);
    // A place with no song moves nothing.
    let isDone = true;
    await act(async () => {
      isDone = await result.current.moveSong(5, 0);
    });
    expect(isDone).toBe(false);
    expect(pi.moveSonosSong).toHaveBeenCalledTimes(1);
  });

  it('says when a control fails', async () => {
    const { result } = await follow();
    pi.controlSonos.mockRejectedValueOnce(new Error('Sonos: the speaker did not answer in time.'));
    let isDone = true;
    await act(async () => {
      isDone = await result.current.nextTrack();
    });
    expect(isDone).toBe(false);
    expect(result.current.error).toBe('Sonos: the speaker did not answer in time.');
  });

  it('sends the volume once the slider rests', async () => {
    const { result } = await follow();
    vi.useFakeTimers();
    act(() => {
      result.current.setVolume(10);
      result.current.setVolume(25);
    });
    expect(result.current.playback?.device?.volume_percent).toBe(25);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(pi.setSonosVolume).toHaveBeenCalledTimes(1);
    expect(pi.setSonosVolume).toHaveBeenCalledWith('Kitchen', 25);
  });

  it('says when the volume could not be set', async () => {
    const { result } = await follow();
    pi.setSonosVolume.mockRejectedValueOnce(new Error('Sonos did not do that.'));
    vi.useFakeTimers();
    act(() => result.current.setVolume(20));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(result.current.error).toBe('Sonos did not do that.');
  });

  it('plays picked music on the group’s leading room', async () => {
    const { result } = await follow();
    await act(() => result.current.play(URI));
    expect(pi.playOnSonosRoom).toHaveBeenCalledWith('Kitchen', URI);
    pi.playOnSonosRoom.mockRejectedValueOnce(new Error('This song can’t be played on Sonos.'));
    let isDone = true;
    await act(async () => {
      isDone = await result.current.play('spotify:collection');
    });
    expect(isDone).toBe(false);
    expect(result.current.error).toBe('This song can’t be played on Sonos.');
  });

  it('pauses the group and stops following it when leaving', async () => {
    const { result } = await follow();
    pi.controlSonos.mockRejectedValueOnce(new Error('gone'));
    await act(() => result.current.leave());
    expect(pi.controlSonos).toHaveBeenCalledWith('Kitchen', 'pause');
    expect(getKioskSonosLeader()).toBeNull();
    expect(result.current).toMatchObject({ active: false, playback: null });
    await act(() => result.current.leave());
    expect(pi.controlSonos).toHaveBeenCalledTimes(1);
  });

  it('does nothing to a group it does not follow', async () => {
    const { result } = renderHook(() => useSonosPlayer());
    await act(async () => {
      expect(await result.current.nextTrack()).toBe(false);
    });
    expect(pi.controlSonos).not.toHaveBeenCalled();
  });

  it('stops following when the room is gone', async () => {
    pi.findSonosOnPi.mockResolvedValue({ groups: [], ms: 0 });
    const { result } = renderHook(() => useSonosPlayer());
    act(() => setKioskSonosLeader('Kitchen'));
    await waitFor(() => expect(result.current.active).toBe(false));
    expect(pi.getSonosNow).not.toHaveBeenCalled();
  });

  it('finds the group again after a failed read, and says so after several', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    pi.getSonosNow.mockRejectedValue(new Error('The kiosk’s audio service did not answer.'));
    const { result } = renderHook(() => useSonosPlayer());
    act(() => setKioskSonosLeader('Kitchen'));
    await waitFor(() => expect(pi.getSonosNow).toHaveBeenCalledTimes(1));
    expect(result.current.error).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    await waitFor(() => expect(result.current.error).toBe('The kiosk’s audio service did not answer.'));
    expect(pi.findSonosOnPi).toHaveBeenCalledTimes(3);
    pi.getSonosNow.mockResolvedValue(NOW);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it('reads less often while nobody watches', async () => {
    const { result } = await follow();
    vi.useFakeTimers();
    act(() => result.current.setSlowPolling(true));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const reads = pi.getSonosNow.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(pi.getSonosNow).toHaveBeenCalledTimes(reads);
    await act(() => vi.advanceTimersByTimeAsync(25_000));
    expect(pi.getSonosNow.mock.calls.length).toBeGreaterThan(reads);
  });

  it('reads the group as soon as the Pi says the speakers changed, and only rarely otherwise', async () => {
    await follow();
    vi.useFakeTimers();
    act(() => watching.live(true));
    // The next regular read, after which the group is read only as a fallback.
    await act(() => vi.advanceTimersByTimeAsync(5000));
    const reads = pi.getSonosNow.mock.calls.length;
    const regroups = pi.findSonosOnPi.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(pi.getSonosNow).toHaveBeenCalledTimes(reads);
    act(() => watching.change('now'));
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(pi.getSonosNow).toHaveBeenCalledTimes(reads + 1);
    expect(pi.findSonosOnPi).toHaveBeenCalledTimes(regroups);
    act(() => watching.change('groups'));
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(pi.findSonosOnPi).toHaveBeenCalledTimes(regroups + 1);
  });

  it('reads again when the speakers change during a read', async () => {
    await follow();
    vi.useFakeTimers();
    const { promise, resolve: answer } = deferred<PiSonosNow>();
    pi.getSonosNow.mockReturnValueOnce(promise);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    const reads = pi.getSonosNow.mock.calls.length;
    act(() => watching.change('now'));
    await act(async () => {
      answer(NOW);
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(pi.getSonosNow).toHaveBeenCalledTimes(reads + 1);
  });
});
