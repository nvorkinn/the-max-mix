// cspell:ignore dagsnytt atten
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PodcastPlayback, StoredPodcasts } from 'countdown-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../vendor/countdown-api/src/countdown_api/fixtures/podcasts.json';
import * as api from '../podcasts/api';
import { defined } from '../test/defined';
import { FakeAudio } from '../test/fakeAudio';
import { BACK_S, FORWARD_S, usePodcastPlayer } from './usePodcastPlayer';

const PODCASTS = fixture.value as StoredPodcasts;
const PLAYBACK = fixture.playback as PodcastPlayback;
const DAGSNYTT = defined(PODCASTS.shows[0], 'a show');
const PART_LISTENED = defined(DAGSNYTT.episodes[0], 'a part-listened episode');
const PLAYED = defined(DAGSNYTT.episodes[1], 'a played episode');

const audio = () => {
  const last = FakeAudio.instances.at(-1);
  if (!last) throw new Error('no audio element');
  return last;
};

beforeEach(() => {
  FakeAudio.instances.length = 0;
  vi.stubGlobal('Audio', FakeAudio);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function opened({
  playback = PLAYBACK,
  episode = PART_LISTENED
}: { playback?: PodcastPlayback | null; episode?: typeof PART_LISTENED } = {}) {
  vi.spyOn(api, 'fetchPlayback').mockResolvedValue(playback);
  const report = vi.spyOn(api, 'reportProgress').mockResolvedValue(true);
  const onPlay = vi.fn();
  const hook = renderHook(() => usePodcastPlayer(onPlay));
  act(() => {
    hook.result.current.open({ show: DAGSNYTT, episode });
  });
  return { ...hook, onPlay, report };
}

describe('usePodcastPlayer', () => {
  it('plays an episode from where NRK says it was left, and tells the music to pause', async () => {
    const { result, onPlay } = opened();
    expect(result.current.phase).toBe('loading');
    await waitFor(() => {
      expect(result.current.isPlaying).toBe(true);
    });
    expect(api.fetchPlayback).toHaveBeenCalledWith('dagsnytt_atten', PART_LISTENED.id);
    expect(audio().src).toBe(PLAYBACK.url);
    expect(audio().currentTime).toBe(1027);
    expect(result.current).toMatchObject({ phase: 'ready', position: 1027, duration: 3539 });
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it('starts a finished episode from the start', async () => {
    const finished = { ...PLAYBACK, progress: { position_s: 0, finished: true } };
    const { result } = opened({ playback: finished, episode: PLAYED });
    await waitFor(() => {
      expect(result.current.isPlaying).toBe(true);
    });
    expect(audio().currentTime).toBe(0);
  });

  it("reports the position at NRK's cadence, on a pause, and keeps it for the lists", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result, report } = opened();
    await waitFor(() => {
      expect(result.current.isPlaying).toBe(true);
    });
    act(() => {
      audio().advance(5);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLAYBACK.report.first_after_s * 1000);
    });
    expect(report).toHaveBeenLastCalledWith('dagsnytt_atten', PART_LISTENED.id, 1032);
    expect(result.current.position).toBe(1032);
    act(() => {
      audio().advance(3);
      result.current.togglePlay();
    });
    expect(result.current.isPlaying).toBe(false);
    expect(report).toHaveBeenLastCalledWith('dagsnytt_atten', PART_LISTENED.id, 1035);
    expect(result.current.local.get(PART_LISTENED.id)).toEqual({ position_s: 1035, finished: false });
  });

  it('marks an episode played at its end', async () => {
    const { result } = opened();
    await waitFor(() => {
      expect(result.current.isPlaying).toBe(true);
    });
    act(() => {
      audio().end();
    });
    expect(result.current.local.get(PART_LISTENED.id)).toEqual({ position_s: 0, finished: true });
  });

  it('jumps back and forward, within the episode', async () => {
    const { result, report } = opened();
    await waitFor(() => {
      expect(result.current.isPlaying).toBe(true);
    });
    act(() => {
      result.current.skip(FORWARD_S);
    });
    expect(audio().currentTime).toBe(1057);
    expect(report).toHaveBeenLastCalledWith('dagsnytt_atten', PART_LISTENED.id, 1057);
    act(() => {
      result.current.skip(-BACK_S);
      result.current.seek(-40);
    });
    expect(audio().currentTime).toBe(0);
    act(() => {
      result.current.seek(99_999);
    });
    expect(audio().currentTime).toBe(3539);
  });

  it('says so when the server has nothing to play', async () => {
    const { result } = opened({ playback: null });
    await waitFor(() => {
      expect(result.current.phase).toBe('failed');
    });
    act(() => {
      result.current.togglePlay();
    });
    expect(result.current.isPlaying).toBe(false);
  });

  it('is paused by the music, and says where it stopped when another episode opens', async () => {
    const { result, report } = opened();
    await waitFor(() => {
      expect(result.current.isPlaying).toBe(true);
    });
    act(() => {
      audio().advance(2);
      result.current.pause();
    });
    expect(result.current.isPlaying).toBe(false);
    expect(report).toHaveBeenLastCalledWith('dagsnytt_atten', PART_LISTENED.id, 1029);
    act(() => {
      result.current.togglePlay();
      audio().advance(4);
      result.current.open({ show: DAGSNYTT, episode: PLAYED });
    });
    expect(report).toHaveBeenLastCalledWith('dagsnytt_atten', PART_LISTENED.id, 1033);
    expect(result.current.current?.episode.id).toBe(PLAYED.id);
  });
});
