import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { installCanvasStub } from '../test/canvas';
import { defined } from '../test/defined';
import { SpotifyApiError } from '../spotify/http';
import TabletView from './TabletView';

const player = vi.hoisted(() => {
  type PlayerMock = Record<string, unknown> &
    Partial<
      Record<
        'togglePlay' | 'nextTrack' | 'previousTrack' | 'setVolume' | 'seek' | 'refreshPlayback' | 'transferPlayback',
        Mock
      >
    >;
  const current: PlayerMock = {};
  return { current };
});
const api = vi.hoisted(() => ({
  getQueue: vi.fn(),
  getDevices: vi.fn(),
  reorderDemoQueue: vi.fn(),
  playDemoTrackNow: vi.fn()
}));
const palette = vi.hoisted(() => ({ extractPalette: vi.fn() }));
const airplay = vi.hoisted(() => ({
  listAudioOutputs: vi.fn(),
  watchAudioOutputs: vi.fn(),
  routeAudio: vi.fn(),
  getChosenSpeakers: vi.fn(),
  setChosenSpeakers: vi.fn()
}));
const lyrics = vi.hoisted(() => ({ lrclib: vi.fn() }));

vi.mock('../hooks/useSpotifyPlayer', () => ({ useSpotifyPlayer: () => player.current }));
vi.mock('../spotify/api', () => api);
vi.mock('../spotify/auth', () => ({ startSignIn: vi.fn(), signOut: vi.fn() }));
vi.mock('../utils/colorExtractor', () => palette);
vi.mock('../lyrics/lrclib', () => lyrics);
vi.mock('../audio/airplay', () => airplay);

const track = {
  id: 'tr1',
  name: 'Now Song',
  duration_ms: 1000,
  artists: [{ name: 'Art' }],
  album: { images: [{ url: 'http://art/a.jpg' }] }
};
const queued = [{ id: 'q1', name: 'Queued One', artists: [{ name: 'Q' }], duration_ms: 1000 }];

function setPlayer(overrides: Record<string, unknown> = {}) {
  player.current = {
    isReady: true,
    playbackState: { is_playing: false, item: track, device: { name: 'Kitchen' } },
    isAuthenticated: true,
    isDemoMode: false,
    isLoading: false,
    playbackMode: 'remote',
    browserDeviceId: null,
    error: null,
    refreshPlayback: vi.fn().mockResolvedValue(undefined),
    togglePlay: vi.fn(),
    nextTrack: vi.fn(),
    previousTrack: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    transferPlayback: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

const flush = () => act(async () => {});

beforeEach(() => {
  localStorage.clear();
  installCanvasStub();
  for (const mock of Object.values(api)) mock.mockReset();
  api.getQueue.mockResolvedValue({ queue: queued });
  api.getDevices.mockResolvedValue({ devices: [{ id: 'dev1', name: 'Soundbar' }] });
  palette.extractPalette.mockReset();
  palette.extractPalette.mockResolvedValue({ primary: 'red', secondary: 'blue', dark: 'black' });
  lyrics.lrclib.mockReset();
  lyrics.lrclib.mockResolvedValue({ kind: 'plain', lines: ['Placeholder lyric'], source: 'LRCLIB' });
  setPlayer();
});
afterEach(() => vi.useRealTimers());

describe('TabletView', () => {
  it('swaps the queue for the lyrics and remembers the choice', async () => {
    const { unmount } = render(<TabletView />);
    await flush();
    expect(lyrics.lrclib).not.toHaveBeenCalled();
    const toggle = screen.getByRole('button', { name: 'Lyrics' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    await flush();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('region', { name: 'Upcoming tracks' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Lyrics' })).toHaveTextContent('Placeholder lyric');
    expect(lyrics.lrclib).toHaveBeenCalledWith(
      { title: 'Now Song', artist: 'Art', durationMs: 1000 },
      expect.any(AbortSignal)
    );
    expect(localStorage.getItem('maxmix_lyrics')).toBe('on');

    unmount();
    render(<TabletView />);
    await flush();
    expect(screen.getByRole('region', { name: 'Lyrics' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Up next' }));
    expect(screen.getByRole('region', { name: 'Upcoming tracks' })).toBeInTheDocument();
    expect(localStorage.getItem('maxmix_lyrics')).toBe('off');
  });

  it('shows the connected device and loads the queue', async () => {
    render(<TabletView />);
    await flush();
    expect(screen.getAllByText('Kitchen').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Queued One' })).toBeInTheDocument();
    expect(api.getQueue).toHaveBeenCalled();
    expect(screen.getByText('Spotify Connect remote')).toBeInTheDocument();
  });

  it('applies the extracted album palette to the container', async () => {
    const { container } = render(<TabletView />);
    await flush();
    expect(palette.extractPalette).toHaveBeenCalledWith('http://art/a.jpg');
    expect((container.firstChild as HTMLElement).style.getPropertyValue('--ambient-primary')).toBe('red');
  });

  it.each([
    ['loading', { isLoading: true, isReady: false, isAuthenticated: false, playbackState: null }, 'Connecting...'],
    ['demo', { isDemoMode: true, isReady: false, playbackState: null }, 'Demo session'],
    ['no device', { isReady: false, playbackState: null }, 'Select a Spotify device'],
    ['signed out', { isReady: false, isAuthenticated: false, playbackState: null }, 'Sign in to Spotify']
  ])('describes the %s session state', async (_, overrides, label) => {
    setPlayer(overrides);
    render(<TabletView />);
    await flush();
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(label);
  });

  it('prompts to sign in and does not poll the queue when unauthenticated', async () => {
    setPlayer({ isAuthenticated: false, isReady: false, playbackState: null });
    render(<TabletView />);
    await flush();
    expect(screen.getByText(/Connect your Spotify account in Settings/)).toBeInTheDocument();
    expect(api.getQueue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });

  it('keeps hook errors out of a banner: the footer links to them in the debug console', async () => {
    setPlayer({ error: 'Device offline' });
    render(<TabletView />);
    await flush();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /problem, see details/i }));
    const panel = screen.getByRole('dialog', { name: 'Debug console' });
    expect(within(panel).getAllByText('Device offline').length).toBeGreaterThan(0);
    fireEvent.click(within(panel).getByRole('button', { name: 'Close debug console' }));
    expect(screen.queryByRole('dialog', { name: 'Debug console' })).not.toBeInTheDocument();
  });

  it('opens the debug console when the clock is held for two seconds, not on a tap', async () => {
    vi.useFakeTimers();
    render(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const clock = defined(document.querySelector('.footer-clock'));
    fireEvent.pointerDown(clock, { button: 0 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(clock);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByRole('dialog', { name: 'Debug console' })).not.toBeInTheDocument();
    fireEvent.pointerDown(clock, { button: 0 });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('dialog', { name: 'Debug console' })).toBeInTheDocument();
  });

  it('toggles the debug console with Ctrl+Shift+D', async () => {
    render(<TabletView />);
    await flush();
    fireEvent.keyDown(window, { key: 'D', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'Debug console' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'D', ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole('dialog', { name: 'Debug console' })).not.toBeInTheDocument();
  });

  it('backs off and surfaces queue polling errors, then recovers', async () => {
    vi.useFakeTimers();
    const rateLimited = new SpotifyApiError('Slow down', 429, 30);
    api.getQueue.mockRejectedValueOnce(rateLimited).mockResolvedValue({ queue: queued });
    render(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Slow down');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(api.getQueue).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(api.getQueue).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Queued One' })).toBeInTheDocument();
  });

  it('shows a failed sign-in as an alert', async () => {
    render(<TabletView signInError="Spotify said no" />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Spotify said no');
  });

  it('re-reads the queue when the player says it changed, without polling while the SDK is active', async () => {
    vi.useFakeTimers();
    setPlayer({ sdkActive: true, queueVersion: 1 });
    const { rerender } = render(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.getQueue).toHaveBeenCalledTimes(1);
    // The remote-mode rate (10 s) is not used while the SDK reports changes; the safety net is 20 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_000);
    });
    expect(api.getQueue).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(api.getQueue).toHaveBeenCalledTimes(2);

    setPlayer({ sdkActive: true, queueVersion: 2 });
    rerender(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.getQueue).toHaveBeenCalledTimes(3);
  });

  it('polls the queue every 10 seconds when no SDK events arrive', async () => {
    vi.useFakeTimers();
    render(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    expect(api.getQueue).toHaveBeenCalledTimes(2);
  });

  it('stops polling on unmount', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.getQueue).toHaveBeenCalledTimes(1);
  });

  it('opens the modals from the header', async () => {
    render(<TabletView />);
    await flush();
    expect(screen.queryByRole('button', { name: /jam in spotify/i })).not.toBeInTheDocument();
    api.getDevices.mockResolvedValue({ devices: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Choose a Spotify Connect device' }));
    await flush();
    expect(screen.getByRole('dialog', { name: /choose a spotify device/i })).toBeInTheDocument();
  });

  it('persists the theme and toasts the change', async () => {
    vi.useFakeTimers();
    const { container } = render(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.firstChild).toHaveAttribute('data-theme', 'neon');
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    fireEvent.click(screen.getByRole('button', { name: /paper/i }));
    expect(container.firstChild).toHaveAttribute('data-theme', 'minimal');
    expect(localStorage.getItem('maxmix_theme')).toBe('minimal');
    expect(screen.getByText('Appearance updated to Paper')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3600);
    });
    expect(screen.queryByText('Appearance updated to Paper')).not.toBeInTheDocument();
  });

  it('does not let an earlier toast timer cut a newer toast short', async () => {
    vi.useFakeTimers();
    render(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    fireEvent.click(screen.getByRole('button', { name: /paper/i }));
    expect(screen.getByText('Appearance updated to Paper')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.click(screen.getByRole('button', { name: /studio|neon/i }));
    expect(screen.getByText('Appearance updated to Studio')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(screen.getByText('Appearance updated to Studio')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('Appearance updated to Studio')).not.toBeInTheDocument();
  });

  it('restores a saved theme and ignores unknown values', async () => {
    localStorage.setItem('maxmix_theme', 'minimal');
    const first = render(<TabletView />);
    await flush();
    expect(first.container.firstChild).toHaveAttribute('data-theme', 'minimal');
    first.unmount();
    localStorage.setItem('maxmix_theme', 'bogus');
    const second = render(<TabletView />);
    await flush();
    expect(second.container.firstChild).toHaveAttribute('data-theme', 'neon');
  });

  it('routes player controls to the hook, converting volume to 0..1', async () => {
    setPlayer({
      playbackState: {
        is_playing: true,
        item: { ...track, duration_ms: 1000 },
        device: { name: 'K', volume_percent: 20 }
      }
    });
    render(<TabletView />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next track' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous track' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '50' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), { target: { value: '400' } });
    expect(player.current.togglePlay).toHaveBeenCalled();
    expect(player.current.nextTrack).toHaveBeenCalled();
    expect(player.current.previousTrack).toHaveBeenCalled();
    expect(player.current.setVolume).toHaveBeenCalledWith(0.5);
    expect(player.current.seek).toHaveBeenCalledWith(400);
  });

  it('disables transport when the device is restricted', async () => {
    setPlayer({ playbackState: { is_playing: false, item: track, device: { name: 'K', is_restricted: true } } });
    render(<TabletView />);
    await flush();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });

  describe('demo mode', () => {
    beforeEach(() =>
      setPlayer({
        isDemoMode: true,
        isAuthenticated: false,
        playbackState: { is_playing: false, item: track, device: { name: 'Demo' } }
      })
    );

    it('reorders the queue through the API and toasts the result', async () => {
      api.getQueue.mockResolvedValue({ queue: [{ ...queued[0] }, { id: 'q2', name: 'Two', duration_ms: 1000 }] });
      api.reorderDemoQueue.mockResolvedValue({ queue: [{ id: 'q2', name: 'Two' }, queued[0]] });
      render(<TabletView />);
      await flush();
      fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Two' }), { key: 'ArrowUp' });
      await flush();
      const reordered = expect.arrayContaining([expect.objectContaining({ id: 'q2' })]) as unknown;
      expect(api.reorderDemoQueue).toHaveBeenCalledWith(reordered);
      expect(screen.getByText('Demo queue order updated.')).toBeInTheDocument();
    });

    it('toasts the API error when reordering fails', async () => {
      api.getQueue.mockResolvedValue({ queue: [queued[0], { id: 'q2', name: 'Two' }] });
      api.reorderDemoQueue.mockRejectedValue(new Error('Reorder rejected'));
      render(<TabletView />);
      await flush();
      fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Two' }), { key: 'ArrowUp' });
      await flush();
      expect(screen.getByText('Reorder rejected')).toBeInTheDocument();
    });

    it('plays a track now, replaces the queue and refreshes playback', async () => {
      api.playDemoTrackNow.mockResolvedValue({ remainingQueue: [] });
      render(<TabletView />);
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Play Queued One now' }));
      await flush();
      expect(api.playDemoTrackNow).toHaveBeenCalledWith('q1');
      expect(player.current.refreshPlayback).toHaveBeenCalled();
      expect(screen.getByText('Demo playing: Queued One')).toBeInTheDocument();
      expect(screen.getByText('A little quiet in here.')).toBeInTheDocument();
    });

    it('toasts when play-now fails', async () => {
      api.playDemoTrackNow.mockRejectedValue(new Error('Nope'));
      render(<TabletView />);
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Play Queued One now' }));
      await flush();
      expect(screen.getByText('Nope')).toBeInTheDocument();
      expect(player.current.refreshPlayback).not.toHaveBeenCalled();
    });
  });

  it('selects a speaker through transferPlayback', async () => {
    api.getQueue.mockResolvedValue({ queue: [] });
    render(<TabletView />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a Spotify Connect device' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /Soundbar/ }));
    await flush();
    expect(player.current.transferPlayback).toHaveBeenCalledWith('dev1');
  });

  describe('on the kiosk', () => {
    beforeEach(() => {
      localStorage.setItem('maxmix.kiosk', 'true');
      for (const mock of Object.values(airplay)) mock.mockReset();
      airplay.listAudioOutputs.mockResolvedValue([]);
      airplay.watchAudioOutputs.mockReturnValue(vi.fn());
      airplay.getChosenSpeakers.mockReturnValue(['Kitchen']);
      setPlayer({
        playbackMode: 'browser',
        browserDeviceId: 'web-1',
        playbackState: { is_playing: true, item: track, device: { id: 'dev1', name: 'Soundbar' } }
      });
    });

    it('switches to AirPlay, moving playback to this tablet, and remembers it', async () => {
      render(<TabletView />);
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Choose speakers' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'AirPlay' }));
      await flush();
      expect(player.current.transferPlayback).toHaveBeenCalledWith('web-1');
      expect(airplay.routeAudio).toHaveBeenCalledWith(['Kitchen']);
      expect(localStorage.getItem('maxmix.audioRoute')).toBe('airplay');
      expect(screen.getByText('AirPlay from this tablet')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Choose AirPlay speakers' })).toBeInTheDocument();
    });

    it('does not move playback that is already on this tablet', async () => {
      setPlayer({ playbackMode: 'browser', browserDeviceId: 'web-1', playbackState: { device: { id: 'web-1' } } });
      render(<TabletView />);
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Choose speakers' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'AirPlay' }));
      await flush();
      expect(player.current.transferPlayback).not.toHaveBeenCalled();
    });

    it('does not route before any speaker was chosen', async () => {
      airplay.getChosenSpeakers.mockReturnValue([]);
      render(<TabletView />);
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Choose speakers' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'AirPlay' }));
      await flush();
      expect(airplay.routeAudio).not.toHaveBeenCalled();
    });

    it('goes back to Spotify Connect, handing the sound back to the Pi', async () => {
      localStorage.setItem('maxmix.audioRoute', 'airplay');
      render(<TabletView />);
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Choose speakers' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Spotify Connect' }));
      await flush();
      expect(airplay.routeAudio).toHaveBeenCalledWith([]);
      expect(localStorage.getItem('maxmix.audioRoute')).toBeNull();
      expect(screen.getByText('Spotify browser player')).toBeInTheDocument();
    });

    it('ignores a saved AirPlay mode in demo mode', async () => {
      localStorage.setItem('maxmix.audioRoute', 'airplay');
      setPlayer({ isDemoMode: true });
      render(<TabletView />);
      await flush();
      expect(screen.queryByText('AirPlay from this tablet')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Choose a Spotify Connect device' })).toBeInTheDocument();
    });
  });

  it('shows the clock in the footer', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T09:05:00') });
    render(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(defined(document.querySelector('.footer-clock'))).toHaveTextContent(/9:05|09:05/);
  });
});
