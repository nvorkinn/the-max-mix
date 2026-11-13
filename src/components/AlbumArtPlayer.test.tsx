import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Track } from '../types';
import { partialProps } from '../test/partialProps';
import AlbumArtPlayerFull from './AlbumArtPlayer';
import TrackQueueFull from './TrackQueue';

const AlbumArtPlayer = partialProps(AlbumArtPlayerFull);
const TrackQueue = partialProps(TrackQueueFull);

const playback = {
  is_playing: true,
  progress_ms: 65_000,
  device: { id: 'dev1', name: 'Kitchen', volume_percent: 30 },
  item: {
    name: 'Song',
    duration_ms: 200_000,
    artists: [{ name: 'A' }, { name: 'B' }],
    album: { images: [{ url: 'http://art/1.jpg' }] }
  }
};

function setup(props: Record<string, unknown> = {}) {
  const h = { onPlayPause: vi.fn(), onNext: vi.fn(), onPrevious: vi.fn(), onSeek: vi.fn(), onVolumeChange: vi.fn() };
  render(<AlbumArtPlayer playback={playback} isPlaying controlsEnabled {...h} {...props} />);
  return h;
}

describe('AlbumArtPlayer', () => {
  it('shows track metadata, times and the playing device', () => {
    setup();
    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Song' })).toBeInTheDocument();
    expect(screen.getByText('A, B')).toBeInTheDocument();
    expect(screen.getByText('1:05')).toBeInTheDocument();
    expect(screen.getByText('3:20')).toBeInTheDocument();
    expect(screen.getByAltText('Song album artwork')).toHaveAttribute('src', 'http://art/1.jpg');
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveAttribute('aria-valuetext', '1:05 of 3:20');
  });

  it('renders placeholders when nothing is playing', () => {
    setup({ playback: null, isPlaying: false });
    expect(screen.getByRole('heading', { name: 'Nothing playing' })).toBeInTheDocument();
    expect(screen.getByText('Select a device')).toBeInTheDocument();
    expect(
      screen.queryByText(/now playing|no track playing|ready when you are|choose your next/i)
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('--:--')).toHaveLength(2);
    expect(screen.queryByText('3:00')).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveAttribute(
      'aria-valuetext',
      'Playback time unavailable'
    );
  });

  it('wires transport buttons and toggles the play label', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next track' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous track' }));
    expect(h.onPlayPause).toHaveBeenCalled();
    expect(h.onNext).toHaveBeenCalled();
  });

  describe('shuffle and repeat', () => {
    const modes = () => ({ onToggleShuffle: vi.fn(), onCycleRepeat: vi.fn() });

    it('shows the current settings and sends a press', () => {
      const h = modes();
      setup({ ...h, playback: { ...playback, shuffle_state: true, repeat_state: 'track' } });
      const shuffle = screen.getByRole('button', { name: 'Shuffle' });
      expect(shuffle).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(shuffle);
      fireEvent.click(screen.getByRole('button', { name: 'Repeat one' }));
      expect(h.onToggleShuffle).toHaveBeenCalledTimes(1);
      expect(h.onCycleRepeat).toHaveBeenCalledTimes(1);
    });

    it('shows shuffle and repeat off, and disables what Spotify rules out', () => {
      setup({
        ...modes(),
        playback: {
          ...playback,
          repeat_state: 'off',
          actions: { disallows: { toggling_shuffle: true, toggling_repeat_context: true, toggling_repeat_track: true } }
        }
      });
      expect(screen.getByRole('button', { name: 'Shuffle' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'Shuffle' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Repeat off' })).toBeDisabled();
    });

    it('shows repeat all', () => {
      setup({ ...modes(), playback: { ...playback, repeat_state: 'context' } });
      expect(screen.getByRole('button', { name: 'Repeat all' })).toBeEnabled();
    });
  });

  describe('previous track', () => {
    const press = () => fireEvent.click(screen.getByRole('button', { name: 'Previous track' }));

    it('restarts the song when it is more than 5 seconds in', () => {
      const h = setup({ playback: { ...playback, progress_ms: 5001 } });
      press();
      expect(h.onSeek).toHaveBeenCalledWith(0);
      expect(h.onPrevious).not.toHaveBeenCalled();
    });

    it('goes to the previous song within the first 5 seconds', () => {
      const h = setup({ playback: { ...playback, progress_ms: 5000 } });
      press();
      expect(h.onPrevious).toHaveBeenCalledTimes(1);
      expect(h.onSeek).not.toHaveBeenCalled();
    });

    it('goes to the previous song when the song cannot be seeked', () => {
      const h = setup({
        playback: { ...playback, progress_ms: 60_000, actions: { disallows: { seeking: true } } }
      });
      press();
      expect(h.onPrevious).toHaveBeenCalledTimes(1);
      expect(h.onSeek).not.toHaveBeenCalled();
    });
  });

  it('seeks with a numeric position and reports volume changes', () => {
    const h = setup();
    fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), { target: { value: '90000' } });
    expect(h.onSeek).toHaveBeenCalledWith(90_000);
    const volume = screen.getByRole('slider', { name: 'Volume' });
    expect(volume).toHaveValue('30');
    fireEvent.change(volume, { target: { value: '55' } });
    expect(h.onVolumeChange).toHaveBeenCalledWith(55);
    expect(volume).toHaveValue('55');
  });

  it('rewinds and fast-forwards 15 seconds, stopping at the start and the end of the song', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Back 15 seconds' }));
    expect(h.onSeek).toHaveBeenLastCalledWith(50_000);
    fireEvent.click(screen.getByRole('button', { name: 'Forward 15 seconds' }));
    expect(h.onSeek).toHaveBeenLastCalledWith(80_000);
  });

  it('clamps the 15 second jumps to the song', () => {
    const near = (progress_ms: number) => ({ ...playback, progress_ms });
    const onSeek = vi.fn();
    const { rerender } = render(<AlbumArtPlayer playback={near(5000)} isPlaying controlsEnabled onSeek={onSeek} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back 15 seconds' }));
    expect(onSeek).toHaveBeenLastCalledWith(0);
    rerender(<AlbumArtPlayer playback={near(195_000)} isPlaying controlsEnabled onSeek={onSeek} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forward 15 seconds' }));
    expect(onSeek).toHaveBeenLastCalledWith(200_000);
  });

  it('turns the 15 second jumps off when seeking is not possible', () => {
    setup({ controlsEnabled: false });
    expect(screen.getByRole('button', { name: 'Back 15 seconds' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Forward 15 seconds' })).toBeDisabled();
  });

  it('turns the 15 second jumps off when Spotify disallows seeking', () => {
    setup({ playback: { ...playback, actions: { disallows: { seeking: true } } } });
    expect(screen.getByRole('button', { name: 'Back 15 seconds' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Forward 15 seconds' })).toBeDisabled();
  });

  it('disables controls when they are not enabled', () => {
    setup({ controlsEnabled: false });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next track' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeDisabled();
  });

  it('respects Spotify action restrictions and devices without volume support', () => {
    setup({
      playback: {
        ...playback,
        device: { id: 'dev1', name: 'TV', volume_percent: 10, supports_volume: false },
        actions: { disallows: { skipping_next: true, pausing: true, seeking: true } }
      }
    });
    expect(screen.getByRole('button', { name: 'Next track' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous track' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeDisabled();
  });

  it('uses the resume restriction while paused', () => {
    setup({ isPlaying: false, playback: { ...playback, actions: { disallows: { resuming: true } } } });
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });

  it('clamps progress past the end of the track', () => {
    setup({ playback: { ...playback, progress_ms: 999_999 } });
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveValue('200000');
  });

  it('does not invent a duration for a known track with missing timing data', () => {
    setup({ playback: { ...playback, item: { name: 'Untimed track', artists: [{ name: 'Artist' }] } } });
    expect(screen.getByText('1:05')).toBeInTheDocument();
    expect(screen.getByText('--:--')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeDisabled();
    expect(screen.queryByText('3:00')).not.toBeInTheDocument();
  });

  it.each([true, false])('keeps artwork static and decoration separate from metadata (playing: %s)', isPlaying => {
    setup({ isPlaying });
    expect(screen.queryByRole('button', { name: /celebrate/i })).not.toBeInTheDocument();
    expect(document.querySelector('canvas')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Track information' })).toHaveAttribute('tabindex', '0');
    expect(screen.queryByText('ON REPEAT? WE GET IT.')).not.toBeInTheDocument();
    expect(screen.queryByText('THE SOUNDTRACK STARTS HERE')).not.toBeInTheDocument();
    expect(screen.queryByText('TAKE YOUR TIME.')).not.toBeInTheDocument();
  });

  it('preserves complete long titles and artist names in the scrollable metadata region', () => {
    const title = 'An extended placeholder title '.repeat(20);
    const artist = 'A very long placeholder artist name '.repeat(10);
    setup({ playback: { ...playback, item: { ...playback.item, name: title, artists: [{ name: artist }] } } });
    expect(screen.getByRole('heading', { name: title.trim() })).toHaveTextContent(title.trim());
    expect(screen.getByRole('region', { name: 'Track information' })).toHaveTextContent(artist.trim());
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
  });
});

describe('TrackQueue', () => {
  const tracks: [Track, Track, Track] = [
    {
      id: 'a',
      name: 'One',
      artists: [{ name: 'X' }],
      duration_ms: 125_000
    },
    { id: 'b', title: 'Two', artist: 'Y', duration_ms: 60_000 },
    { uri: 'spotify:track:c', name: 'Three' }
  ];
  const setupQueue = (props = {}) => render(<TrackQueue queue={tracks} {...props} />);

  it('renders tracks', () => {
    setupQueue();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('One');
    expect(items[0]).toHaveTextContent('NEXT');
    expect(items[1]).toHaveTextContent('Y');
    expect(items[2]).toHaveTextContent('Unknown artist');
  });

  it('shows an empty state', () => {
    render(<TrackQueue />);
    expect(screen.getByText('A little quiet in here.')).toBeInTheDocument();
  });

  it('plays the tapped song and is not tappable without a way to play', () => {
    const onPlay = vi.fn();
    const { unmount } = render(<TrackQueue queue={tracks} onPlay={onPlay} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play Two by Y' }));
    expect(onPlay).toHaveBeenCalledWith(1);
    unmount();
    const { unmount: unmountDisabled } = render(<TrackQueue queue={tracks} onPlay={onPlay} playDisabled />);
    expect(screen.getByRole('button', { name: 'Play Two by Y' })).toBeDisabled();
    unmountDisabled();
    render(<TrackQueue queue={tracks} />);
    expect(screen.getByRole('button', { name: 'Play Two by Y' })).toBeDisabled();
  });

  it('does not link tracks out to Spotify', () => {
    setupQueue();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows an error alert', () => {
    setupQueue({ error: 'Queue unavailable' });
    expect(screen.getByRole('alert')).toHaveTextContent('Queue unavailable');
  });

  it.each(['loading', 'idle', 'error'] as const)('does not claim an empty queue while %s', status => {
    render(<TrackQueue queue={[]} status={status} />);
    expect(screen.queryByText('A little quiet in here.')).not.toBeInTheDocument();
  });

  it('labels stale results and allows a queue retry', () => {
    const retry = vi.fn();
    setupQueue({ status: 'error', error: 'Queue unavailable', onRetry: retry });
    expect(screen.getByText('Showing the last known queue.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry queue' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('does not allow a retry while Spotify asks it to wait', () => {
    const retry = vi.fn();
    setupQueue({ status: 'error', error: 'Slow down', onRetry: retry, retryAllowed: false });
    fireEvent.click(screen.getByRole('button', { name: 'Waiting to retry...' }));
    expect(retry).not.toHaveBeenCalled();
  });
});
