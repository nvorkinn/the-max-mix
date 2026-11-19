import { describe, expect, it, vi } from 'vitest';
import type { PlaybackState } from '../types';
import { goBack, nowPlayingCard } from './nowPlaying';

const controls = () => ({
  controlsEnabled: true,
  onPlayPause: vi.fn(),
  onNext: vi.fn(),
  onPrevious: vi.fn(),
  onSeek: vi.fn()
});

const playing: PlaybackState = {
  is_playing: true,
  progress_ms: 61_000,
  item: {
    id: 'song',
    name: 'Midnight City',
    artists: [{ name: 'M83' }, { name: 'Someone' }],
    album: { images: [{ url: 'https://x/cover.jpg' }] },
    duration_ms: 244_000
  }
};

describe('nowPlayingCard', () => {
  it("reads the song, its artists, cover and how far through it is from Spotify's playback", () => {
    expect(nowPlayingCard(playing, controls())).toMatchObject({
      title: 'Midnight City',
      artist: 'M83, Someone',
      artUrl: 'https://x/cover.jpg',
      isPlaying: true,
      progress: 0.25,
      controlsEnabled: true
    });
  });

  it("reads the song from the page's own player and from a Sonos", () => {
    const fromSdk = nowPlayingCard(
      { position: 30_000, duration: 120_000, track_window: { current_track: { name: 'Starboy' } } },
      controls()
    );
    expect(fromSdk).toMatchObject({ title: 'Starboy', artist: '', artUrl: null, isPlaying: false, progress: 0.25 });
    const fromSonos = nowPlayingCard(
      { is_playing: true, item: { title: 'Levitating', artist: 'Dua Lipa', albumArt: 'https://x/a.jpg' } },
      controls()
    );
    expect(fromSonos).toMatchObject({
      title: 'Levitating',
      artist: 'Dua Lipa',
      artUrl: 'https://x/a.jpg',
      progress: 0
    });
  });

  it('is null with no song', () => {
    expect(nowPlayingCard(null, controls())).toBeNull();
    expect(nowPlayingCard({ is_playing: false }, controls())).toBeNull();
  });

  it('goes back the way the Spotify tab does', () => {
    const player = controls();
    nowPlayingCard(playing, player)?.onPrevious();
    expect(player.onSeek).toHaveBeenCalledWith(0);
    expect(player.onPrevious).not.toHaveBeenCalled();
  });
});

describe('goBack', () => {
  it('starts the song over well into it, and goes back a song near its start or when seeking is not allowed', () => {
    const onSeek = vi.fn();
    const onPrevious = vi.fn();
    goBack({ progress_ms: 6000 }, onSeek, onPrevious);
    expect(onSeek).toHaveBeenCalledWith(0);
    goBack({ progress_ms: 4000 }, onSeek, onPrevious);
    goBack({ progress_ms: 60_000, actions: { disallows: { seeking: true } } }, onSeek, onPrevious);
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(2);
  });
});
