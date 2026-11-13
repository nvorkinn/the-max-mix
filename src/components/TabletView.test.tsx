import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { installCanvasStub } from '../test/canvas';
import { defined } from '../test/defined';
import { FakeWebSocket, latestFakeSocket, resetFakeSockets } from '../test/fakeWebSocket';
import { clearLyricsCache } from '../hooks/useLyrics';
import { fetchSpotify, recordSpotifyRetryAfter, resetSpotifyRateLimit, SpotifyApiError } from '../spotify/http';
import TabletView from './TabletView';

const player = vi.hoisted(() => {
  type PlayerMock = Record<string, unknown> &
    Partial<
      Record<
        | 'togglePlay'
        | 'nextTrack'
        | 'skipAhead'
        | 'previousTrack'
        | 'setVolume'
        | 'seek'
        | 'refreshPlayback'
        | 'setSlowPolling'
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
const palette = vi.hoisted(() => ({ extractArtColours: vi.fn() }));
const airplay = vi.hoisted(() => ({
  listAudioOutputs: vi.fn(),
  watchAudioOutputs: vi.fn(),
  routeAudio: vi.fn(),
  getChosenSpeakers: vi.fn(),
  setChosenSpeakers: vi.fn(),
  setSpeakerVolume: vi.fn()
}));
const lyrics = vi.hoisted(() => ({ lrclib: vi.fn() }));
const sonos = vi.hoisted(() => {
  const current: Record<string, unknown> = {};
  return { current };
});

vi.mock('../hooks/useSpotifyPlayer', () => ({ useSpotifyPlayer: () => player.current }));
vi.mock('../spotify/api', () => api);
vi.mock('../spotify/auth', () => ({
  startSignIn: vi.fn(),
  signOut: vi.fn(),
  peopleOnKiosk: () => [],
  isPersonRefused: () => false,
  PEOPLE_LIMIT: 5
}));
vi.mock('../utils/colorExtractor', () => palette);
vi.mock('../lyrics/lrclib', () => lyrics);
// The kiosk's own lyrics service is not there in a test; without this its request would be a real one.
vi.mock('../lyrics/kiosk', () => ({ kioskLyrics: () => Promise.resolve(null) }));
// The kiosk's Bluetooth service is not there in a test.
vi.mock('../audio/bluetooth', () => ({
  listBluetoothSpeakers: vi.fn().mockResolvedValue([]),
  scanBluetoothSpeakers: vi.fn().mockResolvedValue([]),
  connectBluetoothSpeaker: vi.fn().mockResolvedValue(undefined),
  forgetBluetoothSpeaker: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../audio/airplay', () => airplay);
vi.mock('../hooks/useSonosPlayer', () => ({ useSonosPlayer: () => sonos.current }));
// The Pi's Sonos service is not there in a test.
vi.mock('../sonos/kiosk', async importOriginal => ({
  ...(await importOriginal<typeof import('../sonos/kiosk')>()),
  findSonosOnPi: vi.fn().mockResolvedValue({ groups: [], ms: 0 }),
  watchSonosOnPi: vi.fn(() => vi.fn())
}));

const track = {
  id: 'tr1',
  name: 'Now Song',
  duration_ms: 1000,
  artists: [{ name: 'Art' }],
  album: { images: [{ url: 'http://art/a.jpg' }] }
};
const playing = { is_playing: true, item: track, device: { name: 'Kitchen' } };
const queued = [{ id: 'q1', name: 'Queued One', artists: [{ name: 'Q' }], duration_ms: 1000 }];

function setSonos(overrides: Record<string, unknown> = {}) {
  sonos.current = {
    active: false,
    name: null,
    playback: null,
    next: [],
    error: null,
    togglePlay: vi.fn().mockResolvedValue(true),
    nextTrack: vi.fn().mockResolvedValue(true),
    previousTrack: vi.fn().mockResolvedValue(true),
    seek: vi.fn().mockResolvedValue(true),
    setVolume: vi.fn(),
    play: vi.fn().mockResolvedValue(true),
    refresh: vi.fn(),
    leave: vi.fn().mockResolvedValue(undefined),
    setSlowPolling: vi.fn(),
    ...overrides
  };
}

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
    setSlowPolling: vi.fn(),
    togglePlay: vi.fn(),
    nextTrack: vi.fn(),
    skipAhead: vi.fn().mockResolvedValue(true),
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
  palette.extractArtColours.mockReset();
  palette.extractArtColours.mockResolvedValue({ top: 'red', bottom: 'blue' });
  lyrics.lrclib.mockReset();
  // Tests whose queue fails show the lyrics and would otherwise leave this song's lyrics cached for the ones after.
  clearLyricsCache();
  lyrics.lrclib.mockResolvedValue({ kind: 'plain', lines: ['Placeholder lyric'], source: 'LRCLIB' });
  setPlayer();
  setSonos();
});
afterEach(() => vi.useRealTimers());

/** Opens the Software page of the open Settings. */
function openSoftware() {
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Settings' })).getByRole('button', { name: 'Software' })
  );
}

describe('TabletView', () => {
  afterEach(() => {
    // A test that hit Spotify's quota must not stop the polling in the tests after it.
    resetSpotifyRateLimit();
    vi.unstubAllGlobals();
  });

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
    setPlayer({ playbackState: playing });
    api.getQueue.mockResolvedValue({ queue: queued });
    render(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const upcoming = screen.getByRole('region', { name: 'Upcoming tracks' });
    act(() => recordSpotifyRetryAfter(new SpotifyApiError('Device discovery rate limited', 429, 30)));
    expect(screen.getByText('Waiting for Spotify', { selector: 'strong' })).toBeInTheDocument();
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

  it('shows the queue beside the artwork while songs are queued, and fades to the lyrics on the Lyrics button', async () => {
    render(<TabletView />);
    await flush();
    const panels = document.querySelector('.side-panel');
    expect(panels).toHaveAttribute('data-showing', 'queue');
    expect(screen.getByRole('button', { name: 'Queue' })).toHaveAttribute('aria-pressed', 'true');
    // A hidden lyrics panel looks nothing up.
    expect(lyrics.lrclib).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Upcoming tracks' })).not.toHaveAttribute('inert');

    fireEvent.click(screen.getByRole('button', { name: 'Lyrics' }));
    await flush();
    expect(panels).toHaveAttribute('data-showing', 'lyrics');
    // The queue behind the fade cannot be tapped.
    expect(screen.getByRole('region', { name: 'Upcoming tracks' })).toHaveAttribute('inert');
    expect(screen.getByRole('region', { name: 'Lyrics' })).toHaveTextContent('Placeholder lyric');
    expect(screen.getByAltText('Now Song album artwork')).toBeInTheDocument();
    expect(lyrics.lrclib).toHaveBeenCalledWith(
      { title: 'Now Song', artist: 'Art', durationMs: 1000 },
      expect.any(AbortSignal)
    );

    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    expect(panels).toHaveAttribute('data-showing', 'queue');
  });

  it('shows the speakers in the panel from the Speakers button beside it, and the queue again from Queue', async () => {
    render(<TabletView />);
    await flush();
    const nav = screen.getByRole('navigation', { name: 'Beside the artwork' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Speakers' }));
    await flush();
    expect(document.querySelector('.side-panel')).toHaveAttribute('data-showing', 'speakers');
    expect(screen.getByRole('checkbox', { name: 'Soundbar' })).toBeInTheDocument();
    expect(player.current.transferPlayback).not.toHaveBeenCalled();
    fireEvent.click(within(nav).getByRole('button', { name: 'Queue' }));
    expect(document.querySelector('.side-panel')).toHaveAttribute('data-showing', 'queue');
  });

  it('keeps the queue, with its retry, in view when the queue could not be read', async () => {
    api.getQueue.mockRejectedValue(new Error('Queue down'));
    render(<TabletView />);
    await flush();
    expect(document.querySelector('.side-panel')).toHaveAttribute('data-showing', 'queue');
    expect(screen.getByRole('button', { name: 'Retry queue' })).toBeInTheDocument();
  });

  it('shows the lyrics when nothing is queued', async () => {
    api.getQueue.mockResolvedValue({ queue: [] });
    render(<TabletView />);
    await flush();
    expect(document.querySelector('.side-panel')).toHaveAttribute('data-showing', 'lyrics');
    expect(screen.getByRole('button', { name: 'Lyrics' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Lyrics' })).toHaveTextContent('Placeholder lyric');
  });

  it('says so, and stops reading the queue, when Spotify says the quota is used up', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: { reason: 'QUOTA_EXCEEDED' } }, { status: 429 }))
    );
    render(<TabletView />);
    await flush();
    const reads = api.getQueue.mock.calls.length;
    await act(() => fetchSpotify('https://api.spotify.com/v1/me/player', {}));
    // The banner and the status line next to the logo both say it.
    expect(screen.getByRole('alert')).toHaveTextContent('Spotify quota used up');
    expect(api.getQueue.mock.calls).toHaveLength(reads);
  });

  it('has no sleep button off the kiosk', () => {
    render(<TabletView />);
    expect(screen.queryByRole('button', { name: 'Put the screen to sleep' })).not.toBeInTheDocument();
  });

  it('shows the clock in 24-hour time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 16, 46));
    render(<TabletView />);
    expect(document.querySelector('.header-clock')).toHaveTextContent(/^\s*16:46\s*$/);
    expect(document.querySelector('.header-clock')).not.toHaveTextContent(/AM|PM/i);
  });

  it('shows the playing device and loads the queue', async () => {
    render(<TabletView />);
    await flush();
    expect(screen.getAllByText('Kitchen').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Queued One' })).toBeInTheDocument();
    expect(api.getQueue).toHaveBeenCalled();
  });

  it('plays a tapped queue song by skipping past the ones before it, once at a time', async () => {
    let finish = () => {};
    api.getQueue.mockResolvedValue({
      queue: [...queued, { id: 'q2', name: 'Queued Two', artists: [{ name: 'Q' }], duration_ms: 1000 }]
    });
    setPlayer({
      skipAhead: vi.fn(
        () =>
          new Promise<boolean>(resolve => {
            finish = () => resolve(true);
          })
      )
    });
    render(<TabletView />);
    await flush();
    const second = screen.getByRole('button', { name: 'Play Queued Two by Q' });
    fireEvent.click(second);
    expect(player.current.skipAhead).toHaveBeenCalledExactlyOnceWith(2);
    // While the jump runs, the rows cannot be tapped again.
    expect(second).toBeDisabled();
    act(() => {
      finish();
    });
    await flush();
    expect(second).toBeEnabled();
  });

  it('tints the page with colours from the album art', async () => {
    const { container } = render(<TabletView />);
    await flush();
    expect(palette.extractArtColours).toHaveBeenCalledWith('http://art/a.jpg');
    const style = (container.firstChild as HTMLElement).style;
    expect(style.getPropertyValue('--art-tint-top')).toBe('red');
    expect(style.getPropertyValue('--art-tint-bottom')).toBe('blue');
  });

  it('leaves the page plain when the art has no usable colours', async () => {
    palette.extractArtColours.mockResolvedValue(null);
    const { container } = render(<TabletView />);
    await flush();
    expect((container.firstChild as HTMLElement).style.getPropertyValue('--art-tint-top')).toBe('');
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

  it('changes and remembers the colour picked in the settings', async () => {
    setPlayer({ isAuthenticated: false, isReady: false, playbackState: null });
    const { container } = render(<TabletView />);
    await flush();
    const room = defined(container.querySelector('.tablet-container'));
    expect(room).toHaveAttribute('data-colour', 'forest');
    fireEvent.click(screen.getByRole('button', { name: 'Connection settings' }));
    // The sign-in prompt opens the Spotify page.
    expect(screen.getByRole('heading', { name: 'Spotify' })).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Settings' })).getByRole('button', { name: 'Appearance' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Navy' }));
    expect(room).toHaveAttribute('data-colour', 'navy');
    expect(screen.getByRole('button', { name: 'Navy' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('maxmix.themeColour')).toBe('navy');
    localStorage.removeItem('maxmix.themeColour');
  });

  it('does not show confirmed playback indicators or fabricated times without a track', async () => {
    setPlayer({ playbackState: { device: { name: 'Kitchen' } } });
    render(<TabletView />);
    await flush();
    const panel = screen.getByRole('region', { name: 'Now playing' });
    expect(within(panel).getAllByText('--:--')).toHaveLength(2);
    expect(within(panel).queryByText('3:00')).not.toBeInTheDocument();
  });

  it('offers a speaker chooser without transferring playback when no device is active', async () => {
    setPlayer({ isReady: false, playbackState: null });
    render(<TabletView />);
    await flush();
    expect(screen.getByRole('heading', { name: 'Nothing playing' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Speakers:/ }));
    await flush();
    expect(document.querySelector('.side-panel')).toHaveAttribute('data-showing', 'speakers');
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
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
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

  it('shows recovery in a top banner and preserves exact hook errors in the debug console', async () => {
    setPlayer({ error: 'Device offline' });
    render(<TabletView />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Playback problem');
    expect(screen.getByRole('button', { name: 'Refresh playback' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
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
    const clock = defined(document.querySelector('.header-clock'));
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
  });

  it('retries a failed queue immediately and only shows empty after a successful response', async () => {
    api.getQueue.mockRejectedValueOnce(new Error('Queue down')).mockResolvedValue({ queue: [] });
    render(<TabletView />);
    await flush();
    expect(screen.getByText('Queue unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('A little quiet in here.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry queue' }));
    await flush();
    expect(api.getQueue).toHaveBeenCalledTimes(2);
    expect(screen.getByText('A little quiet in here.')).toBeInTheDocument();
  });

  it('labels cached queue contents when a later refresh fails', async () => {
    vi.useFakeTimers();
    setPlayer({ playbackState: playing });
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
    setPlayer({ sdkActive: true, queueVersion: 1, playbackState: playing });
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

    setPlayer({ sdkActive: true, queueVersion: 2, playbackState: playing });
    rerender(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.getQueue).toHaveBeenCalledTimes(3);
  });

  it('polls the queue every 10 seconds when no SDK events arrive', async () => {
    vi.useFakeTimers();
    setPlayer({ playbackState: playing });
    render(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    expect(api.getQueue).toHaveBeenCalledTimes(2);
  });

  it('reads the queue once while paused and polls again once playback starts', async () => {
    vi.useFakeTimers();
    const { rerender } = render(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(api.getQueue).toHaveBeenCalledTimes(1);
    setPlayer({ playbackState: playing });
    rerender(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    expect(api.getQueue).toHaveBeenCalledTimes(3);
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

  it('uses Day unless Night was chosen, ignoring the old maxmix_theme setting', async () => {
    localStorage.setItem('maxmix_theme', 'neon');
    const { container, unmount } = render(<TabletView />);
    await flush();
    expect(container.firstChild).toHaveAttribute('data-theme', 'day');
    unmount();

    localStorage.setItem('maxmix.theme', 'night');
    const night = render(<TabletView />);
    await flush();
    expect(night.container.firstChild).toHaveAttribute('data-theme', 'night');
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

  it('shows and controls the Sonos the kiosk plays on, instead of Spotify', async () => {
    setPlayer({ playbackState: null, problem: { message: 'No active device', recovery: 'choose-speaker' } });
    setSonos({
      active: true,
      name: 'Kitchen + 1',
      playback: {
        is_playing: true,
        progress_ms: 100,
        item: { ...track, name: 'Sonos Song' },
        device: { id: 'sonos:p1', name: 'Kitchen + 1', volume_percent: 30, supports_volume: true }
      },
      next: [{ name: 'After That', artists: [], album: { images: [] } }]
    });
    render(<TabletView />);
    await flush();
    expect(screen.getAllByText('Sonos Song').length).toBeGreaterThan(0);
    expect(screen.getByText('After That')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Speakers:.*Kitchen \+ 1/ })).toBeInTheDocument();
    // Spotify having no player is not this screen's problem while the Sonos plays.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.getQueue).not.toHaveBeenCalled();
    expect(player.current.setSlowPolling).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next track' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous track' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '50' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), { target: { value: '400' } });
    expect(sonos.current['togglePlay']).toHaveBeenCalled();
    expect(sonos.current['nextTrack']).toHaveBeenCalled();
    expect(sonos.current['previousTrack']).toHaveBeenCalled();
    expect(sonos.current['setVolume']).toHaveBeenCalledWith(50);
    expect(sonos.current['seek']).toHaveBeenCalledWith(400);
    expect(player.current.togglePlay).not.toHaveBeenCalled();
  });

  it('says when the Sonos cannot be read, and reads it again on Refresh', async () => {
    setSonos({ active: true, name: 'Kitchen', error: 'Sonos did not answer (500).' });
    render(<TabletView />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Playback problem');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh playback' }));
    expect(sonos.current['refresh']).toHaveBeenCalled();
    expect(player.current.retryPlayback).not.toHaveBeenCalled();
  });

  it('disables transport when the device is restricted', async () => {
    setPlayer({ playbackState: { is_playing: false, item: track, device: { name: 'K', is_restricted: true } } });
    render(<TabletView />);
    await flush();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });

  it('moves playback to a ticked speaker only on Save, then goes straight back to Speakers', async () => {
    vi.useFakeTimers();
    const { rerender } = render(<TabletView />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole('button', { name: /^Speakers:/ }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const nav = screen.getByRole('navigation', { name: 'Beside the artwork' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Soundbar' }));
    expect(screen.getByRole('checkbox', { name: 'Soundbar' })).toBeChecked();
    expect(player.current.transferPlayback).not.toHaveBeenCalled();
    // While the draft waits, Queue and Lyrics give way to a blank and Cancel, which drops it.
    expect(within(nav).queryByRole('button', { name: 'Queue' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: 'Lyrics' })).not.toBeInTheDocument();
    fireEvent.click(within(nav).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('checkbox', { name: 'Soundbar' })).not.toBeChecked();
    expect(within(nav).getByRole('button', { name: 'Lyrics' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Soundbar' }));
    fireEvent.click(within(nav).getByRole('button', { name: 'Save' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(player.current.transferPlayback).toHaveBeenCalledWith('dev1');
    expect(within(nav).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    // Spotify says it plays there now.
    setPlayer({ playbackState: { is_playing: true, item: track, device: { id: 'dev1', name: 'Soundbar' } } });
    rerender(<TabletView />);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(within(nav).getByRole('button', { name: 'Speakers' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the draft and says so when the speaker never starts playing', async () => {
    vi.useFakeTimers();
    render(<TabletView />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole('button', { name: /^Speakers:/ }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Soundbar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByRole('alert')).toHaveTextContent('The speakers did not take the change.');
    expect(screen.getByRole('checkbox', { name: 'Soundbar' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  describe('on the kiosk', () => {
    beforeEach(() => {
      localStorage.setItem('maxmix.kiosk', 'true');
      for (const mock of Object.values(airplay)) mock.mockReset();
      airplay.listAudioOutputs.mockResolvedValue({ outputs: [], legacy: false });
      airplay.watchAudioOutputs.mockReturnValue(vi.fn());
      airplay.getChosenSpeakers.mockReturnValue(['Kitchen']);
      setPlayer({
        playbackMode: 'browser',
        browserDeviceId: 'web-1',
        playbackState: { is_playing: true, item: track, device: { id: 'dev1', name: 'Soundbar' } }
      });
    });

    it('the sleep button sleeps the screen even while music plays, and slows the polling until a tap wakes it', async () => {
      render(<TabletView />);
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Put the screen to sleep' }));
      expect(screen.getByRole('button', { name: 'Wake the screen' })).toBeInTheDocument();
      expect(player.current.setSlowPolling).toHaveBeenLastCalledWith(true);
      fireEvent.click(screen.getByRole('button', { name: 'Wake the screen' }));
      expect(screen.queryByRole('button', { name: 'Wake the screen' })).not.toBeInTheDocument();
      expect(player.current.setSlowPolling).toHaveBeenLastCalledWith(false);
    });

    describe('when a newer version is out', () => {
      const fetchMock = vi.fn();
      beforeEach(() => {
        localStorage.setItem('maxmix.piVersion', 'v1.12.0 5a39e9a');
        fetchMock.mockReset();
        fetchMock.mockImplementation(() => Promise.resolve(Response.json({ tag_name: 'v1.13.0' })));
        vi.stubGlobal('fetch', fetchMock);
        resetFakeSockets();
        vi.stubGlobal('WebSocket', FakeWebSocket);
      });
      afterEach(() => vi.unstubAllGlobals());

      it('asks once, and Not now keeps it quiet', async () => {
        const { unmount } = render(<TabletView />);
        expect(await screen.findByRole('dialog', { name: 'Update available' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
        expect(screen.queryByRole('dialog', { name: 'Update available' })).not.toBeInTheDocument();
        unmount();
        render(<TabletView />);
        await flush();
        expect(screen.queryByRole('dialog', { name: 'Update available' })).not.toBeInTheDocument();
      });

      it('Update now opens the update stream and the console in place of the tablet', async () => {
        render(<TabletView />);
        await screen.findByRole('dialog', { name: 'Update available' });
        fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
        expect(await screen.findByRole('dialog', { name: 'Updating the Pi' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'Update available' })).not.toBeInTheDocument();
        expect(latestFakeSocket().url).toBe('ws://127.0.0.1:7341/power/update');
        act(() => latestFakeSocket().receive({ type: 'log', line: '2026-11-04T20:00:00+0000 kiosk-pull[1]: hello' }));
        expect(screen.getByLabelText('Update output')).toHaveTextContent('kiosk-pull[1]: hello');
      });

      it('does not ask while the screen sleeps, but does once it wakes', async () => {
        render(<TabletView />);
        await screen.findByRole('dialog', { name: 'Update available' });
        // A dialog would show over the black sleep screen, so the question waits for the screen to wake.
        fireEvent.click(screen.getByRole('button', { name: 'Put the screen to sleep' }));
        expect(screen.queryByRole('dialog', { name: 'Update available' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Wake the screen' }));
        expect(await screen.findByRole('dialog', { name: 'Update available' })).toBeInTheDocument();
      });

      it('asks GitHub again each time Settings opens, and shows what it finds', async () => {
        render(<TabletView />);
        await screen.findByRole('dialog', { name: 'Update available' });
        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
        const asked = fetchMock.mock.calls.length;
        fetchMock.mockImplementation(() => Promise.resolve(Response.json({ tag_name: 'v1.14.0' })));
        fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
        openSoftware();
        expect(await screen.findByText(/v1\.14\.0 is out\. Tap the button to install it now/)).toBeInTheDocument();
        expect(fetchMock.mock.calls.length).toBeGreaterThan(asked);
        // The newer version is asked about at once, over the open Settings.
        expect(screen.getByRole('dialog', { name: 'Update available' })).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
      });

      it('Update now in the popup over Settings closes Settings and opens the console; Not now leaves Settings open', async () => {
        render(<TabletView />);
        await screen.findByRole('dialog', { name: 'Update available' });
        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
        fetchMock.mockImplementation(() => Promise.resolve(Response.json({ tag_name: 'v1.14.0' })));
        fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
        await screen.findByRole('dialog', { name: 'Update available' });
        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
        expect(screen.queryByRole('dialog', { name: 'Update available' })).not.toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

        // The next one (v1.15.0) is accepted: the console replaces Settings.
        fetchMock.mockImplementation(() => Promise.resolve(Response.json({ tag_name: 'v1.15.0' })));
        fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
        fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
        const popup = await screen.findByRole('dialog', { name: 'Update available' });
        fireEvent.click(within(popup).getByRole('button', { name: 'Update now' }));
        expect(await screen.findByRole('dialog', { name: 'Updating the Pi' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
      });

      it('Check for updates in Settings asks again after Not now, and the update starts from the popup', async () => {
        render(<TabletView />);
        await screen.findByRole('dialog', { name: 'Update available' });
        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
        fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
        openSoftware();
        // The same version was declined, so opening Settings only says it is out.
        expect(await screen.findByText(/v1\.13\.0 is out\. Tap the button to install it now/)).toBeInTheDocument();
        await flush();
        expect(screen.queryByRole('dialog', { name: 'Update available' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
        const popup = await screen.findByRole('dialog', { name: 'Update available' });
        fireEvent.click(within(popup).getByRole('button', { name: 'Update now' }));
        expect(await screen.findByRole('dialog', { name: 'Updating the Pi' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
      });

      it('asks GitHub again when the screen wakes', async () => {
        fetchMock.mockImplementation(() => Promise.resolve(Response.json({ tag_name: 'v1.12.0' })));
        render(<TabletView />);
        await flush();
        expect(screen.queryByRole('dialog', { name: 'Update available' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Put the screen to sleep' }));
        // A newer release comes out while the screen is off.
        fetchMock.mockImplementation(() => Promise.resolve(Response.json({ tag_name: 'v1.13.0' })));
        const asked = fetchMock.mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: 'Wake the screen' }));
        expect(await screen.findByRole('dialog', { name: 'Update available' })).toBeInTheDocument();
        expect(fetchMock.mock.calls.length).toBeGreaterThan(asked);
      });
    });

    const kitchen = {
      id: 'raop_sink.Kitchen.local.7000',
      name: 'Kitchen',
      kind: 'airplay',
      volume: 60,
      linked: false
    };
    const outputs = (linked: boolean) => ({ outputs: [{ ...kitchen, linked }], legacy: false });
    const openSpeakers = async () => {
      const view = render(<TabletView />);
      await act(() => vi.advanceTimersByTimeAsync(0));
      fireEvent.click(screen.getByRole('button', { name: /^Speakers:/ }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      return view;
    };

    it('points at This tablet in amber when AirPlay is tapped before this tablet plays, and changes nothing', async () => {
      vi.useFakeTimers();
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      airplay.listAudioOutputs.mockResolvedValue(outputs(false));
      await openSpeakers();
      const airPlayTab = screen.getByRole('button', { name: 'AirPlay' });
      expect(airPlayTab).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(airPlayTab);
      expect(airPlayTab).toHaveClass('is-flashing');
      expect(screen.getByRole('checkbox', { name: 'This tablet' })).toHaveClass('is-flashing');
      expect(screen.getByRole('button', { name: 'Spotify Connect' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByRole('checkbox', { name: 'Kitchen' })).not.toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'This tablet' })).not.toBeChecked();
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(scrollIntoView).toHaveBeenCalled();
      expect(airPlayTab).not.toHaveClass('is-flashing');
      expect(airplay.routeAudio).not.toHaveBeenCalled();
      expect(player.current.transferPlayback).not.toHaveBeenCalled();
    });

    it('routes ticked outputs by id on Save while this tablet plays, turning a loud one down first', async () => {
      vi.useFakeTimers();
      setPlayer({ playbackMode: 'browser', browserDeviceId: 'web-1', playbackState: { device: { id: 'web-1' } } });
      airplay.listAudioOutputs.mockResolvedValue(outputs(false));
      await openSpeakers();
      expect(screen.getByRole('button', { name: /^Speakers: Playing on This tablet/ })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'AirPlay' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Kitchen' }));
      expect(airplay.routeAudio).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(airplay.setSpeakerVolume).toHaveBeenCalledWith(expect.objectContaining({ id: kitchen.id }), 25);
      expect(airplay.routeAudio).toHaveBeenCalledWith([kitchen.id], false);
      expect(player.current.transferPlayback).not.toHaveBeenCalled();
      // The Pi says the sound goes there now.
      airplay.listAudioOutputs.mockResolvedValue(outputs(true));
      // One read at a time, so each answer renders before the next look.
      await act(() => vi.advanceTimersByTimeAsync(1000));
      await act(() => vi.advanceTimersByTimeAsync(1000));
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(screen.getByRole('button', { name: 'Speakers' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Speakers: Playing on Kitchen/ })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Kitchen' })).toBeChecked();
    });

    it('hands the sound back to the Pi before moving to a Spotify Connect speaker', async () => {
      vi.useFakeTimers();
      setPlayer({ playbackMode: 'browser', browserDeviceId: 'web-1', playbackState: { device: { id: 'web-1' } } });
      airplay.listAudioOutputs.mockResolvedValue(outputs(true));
      api.getDevices.mockResolvedValue({ devices: [{ id: 'dev2', name: 'Soundbar' }] });
      await openSpeakers();
      fireEvent.click(screen.getByRole('checkbox', { name: 'Soundbar' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(airplay.routeAudio).toHaveBeenCalledWith([], false);
      expect(airplay.setChosenSpeakers).toHaveBeenCalledWith([]);
      expect(player.current.transferPlayback).toHaveBeenCalledWith('dev2');
    });

    it('trusts its own last choice on a Pi still on an older service', async () => {
      vi.useFakeTimers();
      setPlayer({ playbackMode: 'browser', browserDeviceId: 'web-1', playbackState: { device: { id: 'web-1' } } });
      airplay.listAudioOutputs.mockResolvedValue({
        outputs: [{ id: 'Kitchen', name: 'Kitchen', kind: null, volume: null, linked: null }],
        legacy: true
      });
      await openSpeakers();
      fireEvent.click(screen.getByRole('button', { name: 'AirPlay' }));
      expect(screen.getByRole('checkbox', { name: 'Kitchen' })).toBeChecked();
      fireEvent.click(screen.getByRole('checkbox', { name: 'Kitchen' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(airplay.routeAudio).toHaveBeenCalledWith([], true);
    });
  });

  it('shows the clock in the header', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T09:05:00') });
    render(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(defined(document.querySelector('.header-clock'))).toHaveTextContent(/9:05|09:05/);
  });
});
