import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { installCanvasStub, stubMatchMedia } from '../test/canvas.js';

const confetti = vi.hoisted(() => vi.fn());
vi.mock('canvas-confetti', () => ({ default: confetti }));

import AlbumArtPlayerFull from './AlbumArtPlayer.jsx';
import SpotifyJamQueueFull from './SpotifyJamQueue.jsx';
import { partialProps } from '../test/partialProps.js';

const AlbumArtPlayer = partialProps(AlbumArtPlayerFull);
const SpotifyJamQueue = partialProps(SpotifyJamQueueFull);

const playback = {
  is_playing: true,
  progress_ms: 65000,
  device: { name: 'Kitchen', volume_percent: 30 },
  item: {
    name: 'Song',
    duration_ms: 200000,
    artists: [{ name: 'A' }, { name: 'B' }],
    album: { images: [{ url: 'http://art/1.jpg' }] },
    added_by: { name: 'Ann' }
  }
};

/** @param {Record<string, unknown>} [props] */
function setup(props = {}) {
  const h = { onPlayPause: vi.fn(), onNext: vi.fn(), onPrevious: vi.fn(), onSeek: vi.fn(), onVolumeChange: vi.fn() };
  render(<AlbumArtPlayer playback={/** @type {any} */ (playback)} isPlaying controlsEnabled {...h} {...props} />);
  return h;
}

beforeEach(() => {
  installCanvasStub();
  stubMatchMedia(false);
});

describe('AlbumArtPlayer', () => {
  it('shows track metadata, times and device', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Song' })).toBeInTheDocument();
    expect(screen.getByText('A, B')).toBeInTheDocument();
    expect(screen.getByText('1:05')).toBeInTheDocument();
    expect(screen.getByText('3:20')).toBeInTheDocument();
    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    expect(screen.getByAltText('Song album artwork')).toHaveAttribute('src', 'http://art/1.jpg');
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveAttribute('aria-valuetext', '1:05 of 3:20');
  });

  it('renders placeholders when nothing is playing', () => {
    setup({ playback: null, isPlaying: false });
    expect(screen.getByRole('heading', { name: 'Ready when you are' })).toBeInTheDocument();
    expect(screen.getByText('Select a device in Speakers')).toBeInTheDocument();
    expect(screen.getByText('0:00')).toBeInTheDocument();
    expect(screen.getByText('3:00')).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('wires transport buttons and toggles the play label', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next track' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous track' }));
    expect(h.onPlayPause).toHaveBeenCalled();
    expect(h.onNext).toHaveBeenCalled();
    expect(h.onPrevious).toHaveBeenCalled();
  });

  it('seeks with a numeric position and reports volume changes', () => {
    const h = setup();
    fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), { target: { value: '90000' } });
    expect(h.onSeek).toHaveBeenCalledWith(90000);
    const volume = screen.getByRole('slider', { name: 'Volume' });
    expect(volume).toHaveValue('30');
    fireEvent.change(volume, { target: { value: '55' } });
    expect(h.onVolumeChange).toHaveBeenCalledWith(55);
    expect(volume).toHaveValue('55');
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
        device: { name: 'TV', volume_percent: 10, supports_volume: false },
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

  it('credits the demo guest only in demo mode, falling back to a diva image on error', () => {
    const { unmount } = render(
      <AlbumArtPlayer playback={/** @type {any} */ (playback)} isDemoMode controlsEnabled onSeek={() => {}} />
    );
    expect(screen.getByText('Ann')).toBeInTheDocument();
    const avatar = /** @type {Element} */ (document.querySelector('.track-credit img'));
    fireEvent.error(avatar);
    expect(avatar.getAttribute('src')).toMatch(/^\/divas\//);
    unmount();
    setup();
    expect(screen.queryByText(/Demo pick by/)).toBeNull();
  });

  it('clamps progress past the end of the track', () => {
    setup({ playback: { ...playback, progress_ms: 999999 } });
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveValue('200000');
  });

  it('celebrates with confetti when the artwork is pressed', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /celebrate song/i }));
    expect(confetti).toHaveBeenCalled();
  });
});

describe('SpotifyJamQueue', () => {
  const tracks = [
    {
      id: 'a',
      name: 'One',
      artists: [{ name: 'X' }],
      duration_ms: 125000,
      added_by: { name: 'Ann', avatar: 'ann.png' }
    },
    { id: 'b', title: 'Two', artist: 'Y', duration_ms: 60000 },
    { uri: 'spotify:track:c', name: 'Three', external_urls: { spotify: 'https://open.spotify.com/track/c' } }
  ];
  const renderQueue = (props = {}) => {
    const h = { onReorderQueue: vi.fn().mockResolvedValue(true), onPlaySongNow: vi.fn(), onOpenJamSettings: vi.fn() };
    render(<SpotifyJamQueue queue={tracks} {...h} {...props} />);
    return h;
  };

  it('renders tracks, durations, count and total length', () => {
    renderQueue();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('One');
    expect(items[0]).toHaveTextContent('2:05');
    expect(items[0]).toHaveTextContent('NEXT');
    expect(items[1]).toHaveTextContent('Y');
    expect(items[2]).toHaveTextContent('Unknown artist');
    expect(items[2]).toHaveTextContent('--:--');
    expect(screen.getByText('3 tracks / 3 min')).toBeInTheDocument();
  });

  it('uses the singular for a single track and shows an empty state', () => {
    const { unmount } = render(<SpotifyJamQueue queue={[tracks[1]]} />);
    expect(screen.getByText('1 track / 1 min')).toBeInTheDocument();
    unmount();
    render(<SpotifyJamQueue />);
    expect(screen.getByText('A little quiet in here.')).toBeInTheDocument();
    expect(screen.getByText('0 tracks')).toBeInTheDocument();
  });

  it('links to Spotify and hides demo-only controls outside demo mode', () => {
    renderQueue();
    expect(screen.getByRole('link', { name: 'Open Three in Spotify' })).toHaveAttribute(
      'href',
      /** @type {{ spotify: string }} */ (tracks[2].external_urls).spotify
    );
    expect(screen.getByRole('link', { name: 'Open One in Spotify' })).toHaveAttribute(
      'href',
      'https://open.spotify.com'
    );
    expect(screen.queryByRole('button', { name: /reorder/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /play .* now/i })).toBeNull();
  });

  it('shows an error alert and opens Jam instructions', () => {
    const h = renderQueue({ error: 'Queue unavailable' });
    expect(screen.getByRole('alert')).toHaveTextContent('Queue unavailable');
    fireEvent.click(screen.getByRole('button', { name: /how to start a jam/i }));
    expect(h.onOpenJamSettings).toHaveBeenCalled();
  });

  it('plays a demo track immediately with confetti', () => {
    const h = renderQueue({ isDemoMode: true });
    fireEvent.click(screen.getByRole('button', { name: 'Play Two now' }));
    expect(confetti).toHaveBeenCalled();
    expect(h.onPlaySongNow).toHaveBeenCalledWith('b', tracks[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Play Three now' }));
    expect(h.onPlaySongNow).toHaveBeenLastCalledWith('spotify:track:c', tracks[2]);
  });

  it('shows the demo guest', () => {
    renderQueue({ isDemoMode: true });
    expect(screen.getByLabelText('Demo guest Ann')).toBeInTheDocument();
  });

  it('reorders with the keyboard and ignores moves past the ends', async () => {
    vi.stubGlobal('requestAnimationFrame', (/** @type {FrameRequestCallback} */ fn) => fn(0));
    const h = renderQueue({ isDemoMode: true });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Two' }), { key: 'ArrowUp' });
    await vi.waitFor(() => expect(h.onReorderQueue).toHaveBeenCalledWith([tracks[1], tracks[0], tracks[2]]));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder One' }), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Three' }), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Three' }), { key: 'Enter' });
    await Promise.resolve();
    expect(h.onReorderQueue).toHaveBeenCalledTimes(1);
  });

  it('reorders by dragging the handle to another row', () => {
    const h = renderQueue({ isDemoMode: true });
    const rows = document.querySelectorAll('.queue-track');
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () =>
        /** @type {DOMRect} */ (/** @type {unknown} */ ({ top: i * 50, bottom: i * 50 + 49 })); // only the fields the component reads;
    });
    const handle = screen.getByRole('button', { name: 'Reorder One' });
    fireEvent.pointerDown(handle, { button: 0, pointerType: 'mouse' });
    expect(rows[0]).toHaveClass('is-dragging');
    fireEvent.pointerMove(window, { clientY: 120 });
    expect(rows[2]).toHaveClass('is-drop-target');
    fireEvent.pointerUp(window);
    expect(h.onReorderQueue).toHaveBeenCalledWith([tracks[1], tracks[2], tracks[0]]);
    expect(rows[0]).not.toHaveClass('is-dragging');
  });

  it('cancels a drag without reordering and ignores non-primary mouse buttons', () => {
    const h = renderQueue({ isDemoMode: true });
    const handle = screen.getByRole('button', { name: 'Reorder One' });
    fireEvent.pointerDown(handle, { button: 2, pointerType: 'mouse' });
    expect(document.querySelector('.is-dragging')).toBeNull();
    fireEvent.pointerDown(handle, { button: 0, pointerType: 'mouse' });
    fireEvent.pointerCancel(window);
    fireEvent.pointerUp(window);
    expect(h.onReorderQueue).not.toHaveBeenCalled();
  });
});
