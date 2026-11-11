import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SonosGroup, SonosPlayback } from '../sonos/api';

const api = vi.hoisted(() => ({
  listSonos: vi.fn(),
  getGroupPlayback: vi.fn(),
  getGroupVolume: vi.fn(),
  setGroupVolume: vi.fn(),
  sendGroupCommand: vi.fn(),
  seekGroup: vi.fn()
}));
const playOnSonosRoom = vi.hoisted(() => vi.fn());
vi.mock('../sonos/api', () => api);
vi.mock('../sonos/kiosk', async original => ({
  ...(await original<typeof import('../sonos/kiosk')>()),
  playOnSonosRoom
}));

const { setKioskSonosLeader, getKioskSonosLeader } = await import('../sonos/kiosk');
const { useSonosPlayer } = await import('./useSonosPlayer');

const KITCHEN: SonosGroup = {
  id: 'g1',
  name: 'Kitchen',
  rooms: ['Kitchen'],
  householdId: 'h1',
  playerIds: ['p1'],
  playing: true
};
const URI = 'spotify:track:1234567890123456789012';
const PLAYBACK: SonosPlayback = {
  playing: true,
  positionMs: 30_000,
  track: { name: 'Song', artist: 'Band', imageUrl: 'https://i.scdn.co/image/a', durationMs: 200_000, uri: URI },
  next: { name: 'Next' },
  canSkip: true,
  canSkipBack: true,
  canSeek: false
};

describe('useSonosPlayer', () => {
  beforeEach(() => {
    api.listSonos.mockReset().mockResolvedValue({ groups: [KITCHEN], rooms: [] });
    api.getGroupPlayback.mockReset().mockResolvedValue(PLAYBACK);
    api.getGroupVolume.mockReset().mockResolvedValue(40);
    api.setGroupVolume.mockReset().mockResolvedValue(undefined);
    api.sendGroupCommand.mockReset().mockResolvedValue(undefined);
    api.seekGroup.mockReset().mockResolvedValue(undefined);
    playOnSonosRoom.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => setKioskSonosLeader(null));
    vi.useRealTimers();
  });

  const follow = async () => {
    const hook = renderHook(() => useSonosPlayer());
    act(() => setKioskSonosLeader('p1'));
    await waitFor(() => expect(hook.result.current.playback).not.toBeNull());
    return hook;
  };

  it('follows nothing until the kiosk plays on a Sonos', () => {
    const { result } = renderHook(() => useSonosPlayer());
    expect(result.current).toMatchObject({ active: false, playback: null, name: null, next: [] });
    expect(api.listSonos).not.toHaveBeenCalled();
  });

  it('shows the group the kiosk plays on as the player: its song, the next one, its volume and controls', async () => {
    const { result } = await follow();
    expect(result.current.active).toBe(true);
    expect(result.current.name).toBe('Kitchen');
    expect(result.current.playback).toMatchObject({
      is_playing: true,
      device: { id: 'sonos:p1', name: 'Kitchen', volume_percent: 40, supports_volume: true },
      item: {
        id: '1234567890123456789012',
        uri: URI,
        name: 'Song',
        artists: [{ name: 'Band' }],
        album: { images: [{ url: 'https://i.scdn.co/image/a' }] },
        duration_ms: 200_000
      },
      actions: { disallows: { seeking: true, skipping_next: false, toggling_shuffle: true } }
    });
    expect(result.current.playback?.progress_ms).toBeGreaterThanOrEqual(30_000);
    expect(result.current.next).toEqual([{ name: 'Next', artists: [], album: { images: [] } }]);
    expect(api.getGroupPlayback).toHaveBeenCalledWith('g1');
  });

  it('pauses, plays, skips and seeks on the group', async () => {
    const { result } = await follow();
    await act(() => result.current.togglePlay());
    expect(api.sendGroupCommand).toHaveBeenLastCalledWith('g1', 'pause');
    expect(result.current.playback?.is_playing).toBe(false);
    await act(() => result.current.togglePlay());
    expect(api.sendGroupCommand).toHaveBeenLastCalledWith('g1', 'play');
    await act(() => result.current.nextTrack());
    expect(api.sendGroupCommand).toHaveBeenLastCalledWith('g1', 'skipToNextTrack');
    await act(() => result.current.previousTrack());
    expect(api.sendGroupCommand).toHaveBeenLastCalledWith('g1', 'skipToPreviousTrack');
    await act(() => result.current.seek(90_000));
    expect(api.seekGroup).toHaveBeenCalledWith('g1', 90_000);
  });

  it('says when a control fails', async () => {
    const { result } = await follow();
    api.sendGroupCommand.mockRejectedValueOnce(new Error('Sonos did not answer (500).'));
    let done = true;
    await act(async () => {
      done = await result.current.nextTrack();
    });
    expect(done).toBe(false);
    expect(result.current.error).toBe('Sonos did not answer (500).');
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
    expect(api.setGroupVolume).toHaveBeenCalledTimes(1);
    expect(api.setGroupVolume).toHaveBeenCalledWith('g1', 25);
  });

  it('plays picked music on the group’s leading room', async () => {
    const { result } = await follow();
    await act(() => result.current.play(URI));
    expect(playOnSonosRoom).toHaveBeenCalledWith('Kitchen', URI);
    playOnSonosRoom.mockRejectedValueOnce(new Error('This song can’t be played on Sonos.'));
    let done = true;
    await act(async () => {
      done = await result.current.play('spotify:collection');
    });
    expect(done).toBe(false);
    expect(result.current.error).toBe('This song can’t be played on Sonos.');
  });

  it('pauses the group and stops following it when leaving', async () => {
    const { result } = await follow();
    await act(() => result.current.leave());
    expect(api.sendGroupCommand).toHaveBeenCalledWith('g1', 'pause');
    expect(getKioskSonosLeader()).toBeNull();
    expect(result.current).toMatchObject({ active: false, playback: null });
  });

  it('stops following when the room is gone', async () => {
    api.listSonos.mockResolvedValue({ groups: [], rooms: [] });
    const { result } = renderHook(() => useSonosPlayer());
    act(() => setKioskSonosLeader('p1'));
    await waitFor(() => expect(result.current.active).toBe(false));
    expect(api.getGroupPlayback).not.toHaveBeenCalled();
  });

  it('finds the group again after a failed read, and says so after several', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.getGroupPlayback.mockRejectedValue(new Error('Sonos did not answer (410).'));
    const { result } = renderHook(() => useSonosPlayer());
    act(() => setKioskSonosLeader('p1'));
    await waitFor(() => expect(api.getGroupPlayback).toHaveBeenCalledTimes(1));
    expect(result.current.error).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    await waitFor(() => expect(result.current.error).toBe('Sonos did not answer (410).'));
    expect(api.listSonos).toHaveBeenCalledTimes(3);
    api.getGroupPlayback.mockResolvedValue(PLAYBACK);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it('reads less often while nobody watches', async () => {
    const { result } = await follow();
    vi.useFakeTimers();
    act(() => result.current.setSlowPolling(true));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const reads = api.getGroupPlayback.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(api.getGroupPlayback).toHaveBeenCalledTimes(reads);
    await act(() => vi.advanceTimersByTimeAsync(25_000));
    expect(api.getGroupPlayback.mock.calls.length).toBeGreaterThan(reads);
  });
});
