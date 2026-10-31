import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { installCanvasStub } from '../test/canvas';
import { defined } from '../test/defined';
import { recordSpotifyRetryAfter, SpotifyApiError } from '../spotify/http';
import TabletView from './TabletView';

const player = vi.hoisted(() => {
  type PlayerMock = Record<string, unknown> &
    Partial<
      Record<
        | 'togglePlay'
        | 'nextTrack'
        | 'previousTrack'
        | 'setVolume'
        | 'seek'
        | 'refreshPlayback'
        | 'transferPlayback'
        | 'retryPlayback'
        | 'reconnectPlayer'
        | 'allowBrowserAudio',
        Mock
      >
    >;
  const current: PlayerMock = {};
  return { current };
});
const api = vi.hoisted(() => ({
  getQueue: vi.fn(),
  getDevices: vi.fn()
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
    isLoading: false,
    isConnecting: false,
    playbackMode: 'remote',
    browserDeviceId: null,
    error: null,
    problem: typeof overrides['error'] === 'string' ? { message: overrides['error'], recovery: 'refresh' } : null,
    refreshPlayback: vi.fn().mockResolvedValue(undefined),
    togglePlay: vi.fn(),
    nextTrack: vi.fn(),
    previousTrack: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    transferPlayback: vi.fn().mockResolvedValue(undefined),
    retryPlayback: vi.fn().mockResolvedValue(true),
    reconnectPlayer: vi.fn(),
    allowBrowserAudio: vi.fn().mockResolvedValue(true),
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
  it('allows safe manual recovery at short cooldown expiry without waiting for caller backoff', async () => {
    vi.useFakeTimers();
    setPlayer({ problem: { message: 'Rate limited', recovery: 'wait' } });
    api.getQueue.mockRejectedValueOnce(new SpotifyApiError('Rate limited', 429, 1));
    render(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('button', { name: 'Waiting to retry...' })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(api.getQueue).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Retry queue' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Refresh playback' })).toBeEnabled();
    expect(player.current.nextTrack).not.toHaveBeenCalled();
    expect(player.current.retryPlayback).not.toHaveBeenCalled();
  });

  it('shares waiting state across playback and a cached queue, then enables explicit commands after expiry', async () => {
    vi.useFakeTimers();
    api.getQueue.mockResolvedValue({ queue: queued });
    render(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const nowPlaying = screen.getByRole('region', { name: 'Now playing' });
    const upcoming = screen.getByRole('region', { name: 'Upcoming tracks' });
    act(() => recordSpotifyRetryAfter(new SpotifyApiError('Device discovery rate limited', 429, 30)));
    expect(within(nowPlaying).getByText('Waiting for Spotify')).toBeInTheDocument();
    expect(within(upcoming).getByText('Showing the last known queue.')).toBeInTheDocument();
    expect(within(upcoming).getByText('Queued One')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next track' }));
    expect(player.current.nextTrack).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_999);
    });
    expect(api.getQueue).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Next track' })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(api.getQueue).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Next track' })).toBeEnabled();
    expect(player.current.nextTrack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Next track' }));
    expect(player.current.nextTrack).toHaveBeenCalledOnce();
  });

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
    [
      'loading',
      { isLoading: true, isReady: false, isAuthenticated: true, playbackState: null },
      'Connecting to Spotify...'
    ],
    ['no device', { isReady: false, playbackState: null }, 'Choose a Spotify speaker'],
    ['signed out', { isReady: false, isAuthenticated: false, playbackState: null }, 'Spotify not connected']
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
    const panel = screen.getByRole('region', { name: 'Now playing' });
    expect(within(panel).getByRole('heading', { name: 'Bring your music to the tablet' })).toBeInTheDocument();
    expect(api.getQueue).not.toHaveBeenCalled();
    expect(screen.queryByRole('slider', { name: 'Playback position' })).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Connection settings' }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });

  it('does not show confirmed playback indicators or fabricated times without a track', async () => {
    setPlayer({ playbackState: { device: { name: 'Kitchen' } } });
    render(<TabletView />);
    await flush();
    const panel = screen.getByRole('region', { name: 'Now playing' });
    expect(within(panel).getAllByText('--:--')).toHaveLength(2);
    expect(within(panel).queryByText('3:00')).not.toBeInTheDocument();
    for (const dot of document.querySelectorAll('.session-status .status-dot, .app-footer .status-dot')) {
      expect(dot).toHaveClass('status-dot-idle');
    }
  });

  it('offers a speaker chooser without transferring playback when no device is active', async () => {
    setPlayer({ isReady: false, playbackState: null });
    render(<TabletView />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Choose speaker' }));
    await flush();
    expect(screen.getByRole('dialog', { name: 'Choose a Spotify device' })).toBeInTheDocument();
    expect(player.current.transferPlayback).not.toHaveBeenCalled();
    expect(player.current.togglePlay).not.toHaveBeenCalled();
  });

  it('keeps explicit Play available for a ready browser device without an active track', async () => {
    setPlayer({ isReady: false, playbackState: null, browserDeviceId: 'this-browser' });
    render(<TabletView />);
    await flush();
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next track' })).toBeDisabled();
    expect(player.current.transferPlayback).not.toHaveBeenCalled();
  });

  it('marks offline playback distinctly and disables live controls', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<TabletView />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('No internet connection');
    expect(screen.getByText('Playback controls are offline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(document.querySelector('.session-status')).toHaveTextContent('Offline');
  });

  it.each([
    ['refresh', 'Refresh playback', 'retryPlayback'],
    ['reconnect', 'Reconnect player', 'reconnectPlayer'],
    ['enable-audio', 'Allow browser audio', 'allowBrowserAudio']
  ] as const)('wires %s recovery without reissuing transport commands', async (recovery, label, method) => {
    setPlayer({ error: 'Playback failed', problem: { message: 'Playback failed', recovery } });
    render(<TabletView />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: label }));
    await flush();
    expect(player.current[method]).toHaveBeenCalledOnce();
    expect(player.current.nextTrack).not.toHaveBeenCalled();
    expect(player.current.togglePlay).not.toHaveBeenCalled();
    expect(player.current.transferPlayback).not.toHaveBeenCalled();
  });

  it('keeps refresh busy and prevents duplicate requests', async () => {
    let finish = () => {};
    setPlayer({ error: 'Playback failed' });
    player.current.retryPlayback = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          finish = () => resolve(true);
        })
    );
    render(<TabletView />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh playback' }));
    const pending = screen.getByRole('button', { name: 'Checking...' });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(player.current.retryPlayback).toHaveBeenCalledOnce();
    act(() => {
      finish();
    });
    await flush();
    expect(screen.getByRole('button', { name: 'Refresh playback' })).toBeEnabled();
  });

  it('shows recovery beside controls and preserves exact hook errors in the debug console', async () => {
    setPlayer({ error: 'Device offline' });
    render(<TabletView />);
    await flush();
    expect(within(screen.getByRole('region', { name: 'Now playing' })).getByRole('alert')).toHaveTextContent(
      'Playback problem'
    );
    expect(screen.getByRole('button', { name: 'Refresh playback' })).toBeInTheDocument();
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
    const { rerender } = render(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Slow down');
    expect(screen.getByRole('button', { name: 'Waiting to retry...' })).toBeDisabled();
    setPlayer({ queueVersion: 2 });
    rerender(<TabletView />);
    await flush();
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

  it('shows queue loading instead of an empty queue before a first result', () => {
    api.getQueue.mockReturnValue(new Promise(() => {}));
    render(<TabletView />);
    expect(screen.getByText('Loading queue...')).toBeInTheDocument();
    expect(screen.queryByText('A little quiet in here.')).not.toBeInTheDocument();
    expect(screen.queryByText('0 tracks')).not.toBeInTheDocument();
  });

  it('retries a failed queue immediately and only shows empty after a successful response', async () => {
    api.getQueue.mockRejectedValueOnce(new Error('Queue down')).mockResolvedValue({ queue: [] });
    render(<TabletView />);
    await flush();
    expect(screen.getByText('Queue unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('A little quiet in here.')).not.toBeInTheDocument();
    expect(screen.queryByText('0 tracks')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry queue' }));
    await flush();
    expect(api.getQueue).toHaveBeenCalledTimes(2);
    expect(screen.getByText('A little quiet in here.')).toBeInTheDocument();
    expect(screen.getByText('0 tracks')).toBeInTheDocument();
  });

  it('labels cached queue contents when a later refresh fails', async () => {
    vi.useFakeTimers();
    api.getQueue.mockResolvedValueOnce({ queue: queued }).mockRejectedValueOnce(new Error('Queue down'));
    render(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByRole('heading', { name: 'Queued One' })).toBeInTheDocument();
    expect(screen.getByText('Showing the last known queue.')).toBeInTheDocument();
    expect(screen.getByText('1 track last known')).toBeInTheDocument();
  });

  it('shows a failed sign-in as an alert', async () => {
    render(<TabletView signInError="Spotify said no" />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Spotify said no');
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(
      within(screen.getByRole('dialog', { name: 'Debug console' })).getAllByText('Spotify said no').length
    ).toBeGreaterThan(0);
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

    it('can switch to AirPlay and clear a saved speaker without a ready browser player', async () => {
      setPlayer({ isReady: false, isAuthenticated: false, browserDeviceId: null, playbackState: null });
      render(<TabletView />);
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Choose speakers' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'AirPlay' }));
      await flush();
      const kitchen = screen.getByRole('button', { name: /Kitchen/ });
      expect(kitchen).toHaveTextContent('Not on the network');
      fireEvent.click(kitchen);
      expect(airplay.setChosenSpeakers).toHaveBeenCalledExactlyOnceWith([]);
      expect(airplay.routeAudio).not.toHaveBeenCalled();
      expect(player.current.transferPlayback).not.toHaveBeenCalled();
      expect(player.current.togglePlay).not.toHaveBeenCalled();
    });

    it.each(['web-1', null])(
      'opening a saved AirPlay dialog with browser device %s does not route or play',
      async browserDeviceId => {
        localStorage.setItem('maxmix.audioRoute', 'airplay');
        setPlayer({ browserDeviceId, isReady: Boolean(browserDeviceId) });
        render(<TabletView />);
        await flush();
        fireEvent.click(screen.getByRole('button', { name: 'Choose speakers' }));
        await flush();
        expect(screen.getByRole('heading', { name: 'Choose AirPlay speakers' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Kitchen/ })).toHaveTextContent('Selected');
        expect(airplay.setChosenSpeakers).not.toHaveBeenCalled();
        expect(airplay.routeAudio).not.toHaveBeenCalled();
        expect(player.current.transferPlayback).not.toHaveBeenCalled();
        expect(player.current.togglePlay).not.toHaveBeenCalled();
      }
    );

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
