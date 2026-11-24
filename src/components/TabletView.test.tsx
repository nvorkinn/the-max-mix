import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { TouchscreenConfig } from 'countdown-api';
import { installCanvasStub } from '../test/canvas';
import { defined } from '../test/defined';
import { FakeWebSocket, latestFakeSocket, resetFakeSockets } from '../test/fakeWebSocket';
import { clearLyricsCache } from '../hooks/useLyrics';
import { fetchSpotify, recordSpotifyRetryAfter, resetSpotifyRateLimit, SpotifyApiError } from '../spotify/http';
import fixture from '../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import * as deviceConfig from '../countdown/config';
import { renderOnSpotifyTab } from '../test/onSpotifyTab';
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
        | 'reconnectPlayer',
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
const lyrics = vi.hoisted(() => ({ kioskLyrics: vi.fn() }));
const sonos = vi.hoisted(() => {
  const current: Record<string, unknown> = {};
  return { current };
});

vi.mock('../hooks/useSpotifyPlayer', () => ({ useSpotifyPlayer: () => player.current }));
vi.mock('../spotify/api', () => api);
const people = vi.hoisted(() => ({
  peopleOnKiosk: vi.fn((): unknown[] => []),
  switchPerson: vi.fn(),
  reloadSettings: vi.fn(),
  readBluetoothReport: vi.fn(),
  takePhoneToPair: vi.fn((): string | null => null)
}));
vi.mock('../spotify/settings', async importOriginal => ({
  ...(await importOriginal<typeof import('../spotify/settings')>()),
  reloadSettings: people.reloadSettings
}));
vi.mock('../utils/bluetoothMonitor', () => ({
  readBluetoothReport: people.readBluetoothReport,
  pairPhone: () => Promise.resolve(),
  watchPresence: () => Promise.resolve()
}));
vi.mock('../spotify/auth', () => ({
  signOut: vi.fn(),
  peopleOnKiosk: people.peopleOnKiosk,
  PEOPLE_LIMIT: 5,
  switchPerson: people.switchPerson,
  takePhoneToPair: people.takePhoneToPair,
  getActivePersonId: () => 'me'
}));
vi.mock('../utils/colorExtractor', () => palette);
// The kiosk's own lyrics service is not there in a test; without this its request would be a real one.
vi.mock('../lyrics/kiosk', () => lyrics);
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
    ...overrides
  };
}

const flush = () => act(async () => {});
/** Shows the Settings tab, whose header has the person switcher. */
const showSettingsTab = () => fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));

beforeEach(() => {
  localStorage.clear();
  installCanvasStub();
  for (const mock of Object.values(api)) mock.mockReset();
  api.getQueue.mockResolvedValue({ queue: queued });
  api.getDevices.mockResolvedValue({ devices: [{ id: 'dev1', name: 'Soundbar' }] });
  palette.extractArtColours.mockReset();
  palette.extractArtColours.mockResolvedValue({
    dominant: [
      [200, 40, 60],
      [30, 90, 160]
    ]
  });
  lyrics.kioskLyrics.mockReset();
  // The lyrics are looked up as each song starts, and would otherwise stay cached for the tests after.
  clearLyricsCache();
  lyrics.kioskLyrics.mockResolvedValue({ kind: 'plain', lines: ['Placeholder lyric'], source: 'LRCLIB' });
  setPlayer();
  setSonos();
});
afterEach(() => vi.useRealTimers());

/** Opens the About page of the open Settings. */
function openAbout() {
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Settings' })).getByRole('button', { name: 'About' }));
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
    renderOnSpotifyTab(<TabletView />);
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
    renderOnSpotifyTab(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const upcoming = screen.getByRole('region', { name: 'Upcoming tracks' });
    act(() => recordSpotifyRetryAfter(new SpotifyApiError('Device discovery rate limited', 429, 30)));
    fireEvent.click(screen.getByRole('button', { name: 'Problems' }));
    const problems = screen.getByRole('dialog', { name: 'Problems' });
    expect(within(problems).getByText('Waiting for Spotify')).toBeInTheDocument();
    fireEvent.click(within(problems).getByRole('button', { name: 'Close' }));
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

  it('opens the panel beside the artwork on the lyrics, looked up as the song starts, and fades to the queue on Queue', async () => {
    renderOnSpotifyTab(<TabletView />);
    await flush();
    const panels = document.querySelector('.side-panel');
    expect(panels).toHaveAttribute('data-showing', 'lyrics');
    expect(screen.getByRole('button', { name: 'Lyrics' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Lyrics' })).toHaveTextContent('Placeholder lyric');
    // The queue behind the fade cannot be tapped.
    expect(screen.getByRole('region', { name: 'Upcoming tracks' })).toHaveAttribute('inert');
    expect(screen.getByAltText('Now Song album artwork')).toBeInTheDocument();
    // Looked up once, though both the panel and the screen around it want the lyrics.
    expect(lyrics.kioskLyrics).toHaveBeenCalledExactlyOnceWith(
      { title: 'Now Song', artist: 'Art', durationMs: 1000 },
      expect.any(AbortSignal)
    );

    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    expect(panels).toHaveAttribute('data-showing', 'queue');
    expect(screen.getByRole('region', { name: 'Upcoming tracks' })).not.toHaveAttribute('inert');
    // Going to another tab and back keeps the queue.
    fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Spotify' }));
    expect(panels).toHaveAttribute('data-showing', 'queue');
  });

  it('shows the speakers in the panel from the Speakers button beside it, and the queue again from Queue', async () => {
    renderOnSpotifyTab(<TabletView />);
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

  it('shows the queue, with its retry, when the song has no lyrics and the queue could not be read', async () => {
    lyrics.kioskLyrics.mockResolvedValue(null);
    api.getQueue.mockRejectedValue(new Error('Queue down'));
    renderOnSpotifyTab(<TabletView />);
    await flush();
    expect(document.querySelector('.side-panel')).toHaveAttribute('data-showing', 'queue');
    expect(screen.getByRole('button', { name: 'Retry queue' })).toBeInTheDocument();
  });

  it('shows the queue when the song has no lyrics', async () => {
    lyrics.kioskLyrics.mockResolvedValue(null);
    renderOnSpotifyTab(<TabletView />);
    await flush();
    expect(document.querySelector('.side-panel')).toHaveAttribute('data-showing', 'queue');
    expect(screen.getByRole('button', { name: 'Queue' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('says so, and stops reading the queue, when Spotify says the quota is used up', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: { reason: 'QUOTA_EXCEEDED' } }, { status: 429 }))
    );
    renderOnSpotifyTab(<TabletView />);
    await flush();
    const reads = api.getQueue.mock.calls.length;
    await act(() => fetchSpotify('https://api.spotify.com/v1/me/player', {}));
    // Nothing fixes it, so it is only under the warning.
    fireEvent.click(screen.getByRole('button', { name: 'Problems' }));
    expect(
      within(screen.getByRole('dialog', { name: 'Problems' })).getByText('Spotify quota used up')
    ).toBeInTheDocument();
    expect(api.getQueue.mock.calls).toHaveLength(reads);
  });

  describe('Get started after pairing', () => {
    afterEach(() => {
      people.peopleOnKiosk.mockReturnValue([]);
    });

    it('offers the first Spotify sign-in on the Dashboard until Not now', async () => {
      localStorage.setItem('maxmix.getStarted', '1');
      render(<TabletView />);
      await flush();
      const dialog = screen.getByRole('dialog', { name: 'Bring your music to the tablet' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));
      expect(screen.queryByRole('dialog', { name: 'Bring your music to the tablet' })).not.toBeInTheDocument();
      expect(localStorage.getItem('maxmix.getStarted')).toBeNull();
    });

    it('is done with once someone is signed in', async () => {
      localStorage.setItem('maxmix.getStarted', '1');
      people.peopleOnKiosk.mockReturnValue([
        { spotifyId: 'max', name: 'max', imageUrl: '', phoneAddress: 'phone-max', active: true }
      ]);
      render(<TabletView />);
      await flush();
      expect(screen.queryByRole('dialog', { name: 'Bring your music to the tablet' })).not.toBeInTheDocument();
      expect(localStorage.getItem('maxmix.getStarted')).toBeNull();
    });
  });

  describe('switching person from the banner', () => {
    const face = (spotifyId: string, active: boolean) => ({
      spotifyId,
      name: spotifyId,
      imageUrl: '',
      phoneAddress: `phone-${spotifyId}`,
      active
    });
    beforeEach(() => {
      people.peopleOnKiosk.mockReturnValue([face('max', true), face('anna', false)]);
      people.readBluetoothReport.mockResolvedValue({ phones: [{ address: 'phone-anna', name: '', isHere: true }] });
    });
    afterEach(() => {
      people.peopleOnKiosk.mockReturnValue([]);
      vi.clearAllMocks();
    });

    const switchToAnna = async () => {
      renderOnSpotifyTab(<TabletView />);
      await flush();
      // The Spotify tab floats the Dashboard's bar, which has no switcher; the Settings tab's header does.
      showSettingsTab();
      fireEvent.click(screen.getByRole('button', { name: 'max: switch person' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'anna' }));
      await flush();
    };

    it('pauses this tablet’s own music first, then switches and reloads', async () => {
      setPlayer({
        isPlayerActive: true,
        playbackState: { is_playing: true, item: track, device: { name: 'Kitchen' } },
        togglePlay: vi.fn().mockResolvedValue(true)
      });
      await switchToAnna();
      expect(player.current.togglePlay).toHaveBeenCalledTimes(1);
      expect(people.switchPerson).toHaveBeenCalledWith('anna');
      expect(people.reloadSettings).toHaveBeenCalled();
    });

    it('pauses the kiosk’s Sonos when that is what plays', async () => {
      setSonos({
        active: true,
        name: 'Kitchen',
        playback: { is_playing: true, progress_ms: 0, item: track, device: { id: 'sonos:p1', name: 'Kitchen' } }
      });
      await switchToAnna();
      expect(sonos.current['togglePlay']).toHaveBeenCalledTimes(1);
      expect(people.switchPerson).toHaveBeenCalledWith('anna');
    });

    it('offers to pair the phone of someone who has just signed in, on the kiosk only', async () => {
      people.takePhoneToPair.mockReturnValueOnce('anna');
      localStorage.setItem('maxmix.kiosk', 'true');
      const { unmount } = renderOnSpotifyTab(<TabletView />);
      await flush();
      expect(screen.getByRole('heading', { name: 'Pair anna’s phone' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Let’s do it!' }));
      fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
      expect(screen.queryByRole('heading', { name: 'Pair anna’s phone' })).not.toBeInTheDocument();
      unmount();
      localStorage.removeItem('maxmix.kiosk');
      people.takePhoneToPair.mockClear();
      renderOnSpotifyTab(<TabletView />);
      expect(people.takePhoneToPair).not.toHaveBeenCalled();
    });

    it('leaves music playing elsewhere alone', async () => {
      setPlayer({
        isPlayerActive: false,
        playbackState: { is_playing: true, item: track, device: { name: 'Kitchen' } }
      });
      await switchToAnna();
      expect(player.current.togglePlay).not.toHaveBeenCalled();
      expect(people.switchPerson).toHaveBeenCalledWith('anna');
    });
  });

  it('shows the Spotify and Settings tabs on the Dashboard’s photo', async () => {
    render(<TabletView />);
    await flush();
    // The Dashboard has the photo too, so only the tab's own panel is looked at.
    fireEvent.click(screen.getByRole('tab', { name: 'Spotify' }));
    const spotify = screen.getByRole('tabpanel', { name: 'Spotify' });
    expect(spotify).toHaveClass('on-photo');
    expect(spotify.querySelector('.dashboard-backdrop-photo')).not.toBeNull();
    expect(within(spotify).getByRole('slider', { name: 'Playback position' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    const settings = screen.getByRole('tabpanel', { name: 'Settings' });
    expect(settings).toHaveClass('on-photo');
    expect(settings.querySelector('.dashboard-backdrop-photo')).not.toBeNull();
    // The photo shows on the tab in view only.
    expect(spotify.querySelector('.dashboard-backdrop')).toBeNull();
  });

  it('offers search on the Spotify tab only', async () => {
    render(<TabletView />);
    await flush();
    const search = (tab: string) => document.querySelector(`#app-tab-${tab} [aria-label="Choose music"]`);
    expect(search('spotify')).not.toBeNull();
    expect(search('dashboard')).toBeNull();
    expect(search('settings')).toBeNull();
  });

  it('shows the clock in 24-hour time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 16, 46));
    render(<TabletView />);
    expect(document.querySelector('.floating-bar .dashboard-clock')).toHaveTextContent(/^\s*16:46\s*$/);
    expect(document.querySelector('.floating-bar .dashboard-clock')).not.toHaveTextContent(/AM|PM/i);
  });

  it('shows the playing device and loads the queue', async () => {
    renderOnSpotifyTab(<TabletView />);
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
    renderOnSpotifyTab(<TabletView />);
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

  it('prompts to sign in and does not poll the queue when unauthenticated', async () => {
    setPlayer({ isAuthenticated: false, isReady: false, playbackState: null });
    renderOnSpotifyTab(<TabletView />);
    await flush();
    const panel = screen.getByRole('region', { name: 'Now playing' });
    expect(within(panel).getByRole('heading', { name: 'Bring your music to the tablet' })).toBeInTheDocument();
    expect(api.getQueue).not.toHaveBeenCalled();
    expect(screen.queryByRole('slider', { name: 'Playback position' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Connection settings' })).not.toBeInTheDocument();
  });

  it('changes and remembers the colour picked in the settings', async () => {
    setPlayer({ isAuthenticated: false, isReady: false, playbackState: null });
    const { container } = renderOnSpotifyTab(<TabletView />);
    await flush();
    const room = defined(container.querySelector('.tablet-container'));
    expect(room).toHaveAttribute('data-colour', 'forest');
    showSettingsTab();
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Settings' })).getByRole('button', { name: 'Appearance' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Navy' }));
    expect(room).toHaveAttribute('data-colour', 'navy');
    expect(screen.getByRole('button', { name: 'Navy' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('maxmix.themeColour')).toBe('navy');
    localStorage.removeItem('maxmix.themeColour');
  });

  it('turns Dynamic on over the picked colour, and off again', async () => {
    setPlayer({ isAuthenticated: false, isReady: false, playbackState: null });
    const { container } = renderOnSpotifyTab(<TabletView />);
    await flush();
    const room = defined(container.querySelector('.tablet-container'));
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Settings' })).getByRole('button', { name: 'Appearance' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Navy' }));
    const dynamic = screen.getByRole('switch', { name: 'Dynamic' });
    fireEvent.click(dynamic);
    expect(room).toHaveAttribute('data-dynamic');
    expect(room).toHaveAttribute('data-colour', 'navy');
    // Nothing plays, so Dynamic shows the picked colour.
    expect(room).toHaveStyle({ '--dynamic-accent': '#5b8def' });
    expect(localStorage.getItem('maxmix.dynamicColour')).toBe('on');

    fireEvent.click(dynamic);
    expect(room).not.toHaveAttribute('data-dynamic');
    expect(localStorage.getItem('maxmix.dynamicColour')).toBeNull();
    localStorage.removeItem('maxmix.themeColour');
  });

  describe("once someone owns the kiosk, countdown-server's config", () => {
    const OWNED = { ...fixture.config, style: { skin: 'day', colour: 'teal', dynamic: false } } as TouchscreenConfig;

    function openAppearance() {
      fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
      fireEvent.click(
        within(screen.getByRole('navigation', { name: 'Settings' })).getByRole('button', { name: 'Appearance' })
      );
    }

    it('sets the colour, and a change saves there and says so, keeping its skin as it is', async () => {
      vi.spyOn(deviceConfig, 'loadDeviceConfig').mockResolvedValue(OWNED);
      const save = vi
        .spyOn(deviceConfig, 'saveConfigSection')
        .mockImplementation((section, value) => Promise.resolve({ saved: { ...OWNED, [section]: value } }));
      const { container } = renderOnSpotifyTab(<TabletView />);
      await flush();
      const room = defined(container.querySelector('.tablet-container'));
      expect(room).toHaveAttribute('data-colour', 'teal');
      expect(localStorage.getItem('maxmix.themeColour')).toBe('teal');

      vi.useFakeTimers();
      openAppearance();
      fireEvent.click(screen.getByRole('button', { name: 'Navy' }));
      expect(room).toHaveAttribute('data-colour', 'navy');
      await act(() => vi.advanceTimersByTimeAsync(500));
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0]).toEqual(['style', { skin: 'day', colour: 'navy', dynamic: false }]);
      expect(screen.getByText('Saved')).toBeInTheDocument();
      vi.restoreAllMocks();
    });

    it('takes Dynamic from the config, and turning it on saves it there', async () => {
      vi.spyOn(deviceConfig, 'loadDeviceConfig').mockResolvedValue(OWNED);
      const save = vi
        .spyOn(deviceConfig, 'saveConfigSection')
        .mockImplementation((section, value) => Promise.resolve({ saved: { ...OWNED, [section]: value } }));
      const { container } = renderOnSpotifyTab(<TabletView />);
      await flush();
      const room = defined(container.querySelector('.tablet-container'));
      expect(room).not.toHaveAttribute('data-dynamic');

      vi.useFakeTimers();
      openAppearance();
      fireEvent.click(screen.getByRole('switch', { name: 'Dynamic' }));
      await act(() => vi.advanceTimersByTimeAsync(500));
      expect(save.mock.calls[0]).toEqual(['style', { skin: 'day', colour: 'teal', dynamic: true }]);
      expect(room).toHaveAttribute('data-dynamic');
      expect(localStorage.getItem('maxmix.dynamicColour')).toBe('on');
      vi.restoreAllMocks();
      localStorage.clear();
    });

    describe('saying the old Dynamic colour', () => {
      const OLD_DYNAMIC = { ...OWNED, style: { skin: 'day', colour: 'dynamic', dynamic: false } } as TouchscreenConfig;

      async function renderOwned() {
        vi.spyOn(deviceConfig, 'loadDeviceConfig').mockResolvedValue(OLD_DYNAMIC);
        const save = vi
          .spyOn(deviceConfig, 'saveConfigSection')
          .mockImplementation((section, value) => Promise.resolve({ saved: { ...OLD_DYNAMIC, [section]: value } }));
        const { container } = renderOnSpotifyTab(<TabletView />);
        await flush();
        return { room: defined(container.querySelector('.tablet-container')), save };
      }

      it('shows Forest with Dynamic on, and a colour picked keeps Dynamic on', async () => {
        const { room, save } = await renderOwned();
        expect(room).toHaveAttribute('data-colour', 'forest');
        expect(room).toHaveAttribute('data-dynamic');
        expect(localStorage.getItem('maxmix.dynamicColour')).toBe('on');

        vi.useFakeTimers();
        openAppearance();
        fireEvent.click(screen.getByRole('button', { name: 'Navy' }));
        await act(() => vi.advanceTimersByTimeAsync(500));
        expect(save.mock.calls[0]).toEqual(['style', { skin: 'day', colour: 'navy', dynamic: true }]);
        expect(room).toHaveAttribute('data-colour', 'navy');
        expect(room).toHaveAttribute('data-dynamic');
        vi.restoreAllMocks();
        localStorage.clear();
      });

      it('turned off, saves the default colour there', async () => {
        const { room, save } = await renderOwned();
        vi.useFakeTimers();
        openAppearance();
        fireEvent.click(screen.getByRole('switch', { name: 'Dynamic' }));
        await act(() => vi.advanceTimersByTimeAsync(500));
        expect(save.mock.calls[0]).toEqual(['style', { skin: 'day', colour: 'forest', dynamic: false }]);
        expect(room).not.toHaveAttribute('data-dynamic');
        vi.restoreAllMocks();
        localStorage.clear();
      });
    });

    it('puts a change back when it does not save', async () => {
      vi.spyOn(deviceConfig, 'loadDeviceConfig').mockResolvedValue(OWNED);
      vi.spyOn(deviceConfig, 'saveConfigSection').mockResolvedValue({ error: 'failed' });
      const { container } = renderOnSpotifyTab(<TabletView />);
      await flush();
      vi.useFakeTimers();
      openAppearance();
      fireEvent.click(screen.getByRole('button', { name: 'Navy' }));
      await act(() => vi.advanceTimersByTimeAsync(500));
      expect(screen.getByText('Not saved')).toBeInTheDocument();
      expect(defined(container.querySelector('.tablet-container'))).toHaveAttribute('data-colour', 'teal');
      vi.restoreAllMocks();
    });
  });

  it('does not show confirmed playback indicators or fabricated times without a track', async () => {
    setPlayer({ playbackState: { device: { name: 'Kitchen' } } });
    renderOnSpotifyTab(<TabletView />);
    await flush();
    const panel = screen.getByRole('region', { name: 'Now playing' });
    expect(within(panel).getAllByText('--:--')).toHaveLength(2);
    expect(within(panel).queryByText('3:00')).not.toBeInTheDocument();
  });

  it('offers a speaker chooser without transferring playback when no device is active', async () => {
    setPlayer({ isReady: false, playbackState: null });
    renderOnSpotifyTab(<TabletView />);
    await flush();
    expect(screen.queryByRole('region', { name: 'Track information' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Speakers:/ }));
    await flush();
    expect(document.querySelector('.side-panel')).toHaveAttribute('data-showing', 'speakers');
    expect(player.current.transferPlayback).not.toHaveBeenCalled();
    expect(player.current.togglePlay).not.toHaveBeenCalled();
  });

  it('keeps explicit Play available for a ready browser device without an active track', async () => {
    setPlayer({ isReady: false, playbackState: null, browserDeviceId: 'this-browser' });
    renderOnSpotifyTab(<TabletView />);
    await flush();
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next track' })).toBeDisabled();
    expect(player.current.transferPlayback).not.toHaveBeenCalled();
  });

  it('marks offline playback distinctly and disables live controls', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderOnSpotifyTab(<TabletView />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Problems' }));
    expect(
      within(screen.getByRole('dialog', { name: 'Problems' })).getByText('No internet connection')
    ).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Problems' })).getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });

  it.each([
    ['refresh', 'Refresh playback', 'retryPlayback'],
    ['reconnect', 'Reconnect player', 'reconnectPlayer']
  ] as const)('wires %s recovery without reissuing transport commands', async (recovery, label, method) => {
    setPlayer({ error: 'Playback failed', problem: { message: 'Playback failed', recovery } });
    renderOnSpotifyTab(<TabletView />);
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
    renderOnSpotifyTab(<TabletView />);
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

  it('says a problem in the player, lists it under the warning, and keeps the exact error for the debug console', async () => {
    setPlayer({ error: 'Device offline' });
    renderOnSpotifyTab(<TabletView />);
    await flush();
    const nowPlaying = screen.getByRole('region', { name: 'Now playing' });
    expect(within(nowPlaying).getByRole('alert')).toHaveTextContent('Playback problem');
    expect(within(nowPlaying).getByRole('button', { name: 'Refresh playback' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Problems' }));
    const problems = screen.getByRole('dialog', { name: 'Problems' });
    expect(within(problems).getByText('Playback problem')).toBeInTheDocument();
    expect(within(problems).getByRole('button', { name: 'Refresh playback' })).toBeInTheDocument();
    fireEvent.click(within(problems).getByRole('button', { name: 'Details' }));
    const panel = screen.getByRole('dialog', { name: 'Debug console' });
    expect(within(panel).getAllByText('Device offline').length).toBeGreaterThan(0);
    fireEvent.click(within(panel).getByRole('button', { name: 'Close debug console' }));
    expect(screen.queryByRole('dialog', { name: 'Debug console' })).not.toBeInTheDocument();
  });

  it.each(['Spotify', 'Dashboard', 'Settings'] as const)(
    'opens the debug console when the clock on the %s tab is held for two seconds, not on a tap',
    async tab => {
      vi.useFakeTimers();
      renderOnSpotifyTab(<TabletView />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireEvent.click(screen.getByRole('tab', { name: tab }));
      const clock = defined(document.querySelector(`#app-tab-${tab.toLowerCase()} .dashboard-clock`));
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
    }
  );

  it('toggles the debug console with Ctrl+Shift+D', async () => {
    renderOnSpotifyTab(<TabletView />);
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
    const { rerender } = renderOnSpotifyTab(<TabletView />);
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
    renderOnSpotifyTab(<TabletView />);
    expect(screen.getByText('Loading queue...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Search for music' })).not.toBeInTheDocument();
  });

  it('retries a failed queue immediately and only shows empty after a successful response', async () => {
    api.getQueue.mockRejectedValueOnce(new Error('Queue down')).mockResolvedValue({ queue: [] });
    renderOnSpotifyTab(<TabletView />);
    await flush();
    expect(screen.getByText('Queue unavailable.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Search for music' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry queue' }));
    await flush();
    expect(api.getQueue).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Search for music' })).toBeInTheDocument();
  });

  it('opens the music picker from the empty queue', async () => {
    api.getQueue.mockResolvedValue({ queue: [] });
    renderOnSpotifyTab(<TabletView />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Search for music' }));
    expect(screen.getByRole('dialog', { name: 'Choose music' })).toBeInTheDocument();
  });

  it('labels cached queue contents when a later refresh fails', async () => {
    vi.useFakeTimers();
    setPlayer({ playbackState: playing });
    api.getQueue.mockResolvedValueOnce({ queue: queued }).mockRejectedValueOnce(new Error('Queue down'));
    renderOnSpotifyTab(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByRole('heading', { name: 'Queued One' })).toBeInTheDocument();
    expect(screen.getByText('Showing the last known queue.')).toBeInTheDocument();
  });

  it('starts on the Dashboard, with the tabs in the order Spotify, Dashboard, Settings', async () => {
    render(<TabletView />);
    await flush();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(tab => tab.textContent.trim())).toEqual(['Spotify', 'Dashboard', 'Settings']);
    expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
  });

  it('re-reads the queue when the player says it changed, without polling while the kiosk player is active', async () => {
    vi.useFakeTimers();
    setPlayer({ isPlayerActive: true, queueVersion: 1, playbackState: playing });
    const { rerender } = renderOnSpotifyTab(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.getQueue).toHaveBeenCalledTimes(1);
    // The remote-mode rate (10 s) is not used while the kiosk player reports changes; the safety net is 20 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_000);
    });
    expect(api.getQueue).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(api.getQueue).toHaveBeenCalledTimes(2);

    setPlayer({ isPlayerActive: true, queueVersion: 2, playbackState: playing });
    rerender(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.getQueue).toHaveBeenCalledTimes(3);
  });

  it('polls the queue every 10 seconds when no player events arrive', async () => {
    vi.useFakeTimers();
    setPlayer({ playbackState: playing });
    renderOnSpotifyTab(<TabletView />);
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
    const { rerender } = renderOnSpotifyTab(<TabletView />);
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
    const { unmount } = renderOnSpotifyTab(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.getQueue).toHaveBeenCalledTimes(1);
  });

  it('routes player controls to the hook, converting volume to 0..1', async () => {
    setPlayer({
      playbackState: {
        is_playing: true,
        item: { ...track, duration_ms: 1000 },
        device: { name: 'K', volume_percent: 20 }
      }
    });
    renderOnSpotifyTab(<TabletView />);
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
    renderOnSpotifyTab(<TabletView />);
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
    renderOnSpotifyTab(<TabletView />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Playback problem');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh playback' }));
    expect(sonos.current['refresh']).toHaveBeenCalled();
    expect(player.current.retryPlayback).not.toHaveBeenCalled();
  });

  it('disables transport when the device is restricted', async () => {
    setPlayer({ playbackState: { is_playing: false, item: track, device: { name: 'K', is_restricted: true } } });
    renderOnSpotifyTab(<TabletView />);
    await flush();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });

  it('moves playback to a ticked speaker only on Save, then goes straight back to Speakers', async () => {
    vi.useFakeTimers();
    const { rerender } = renderOnSpotifyTab(<TabletView />);
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
    renderOnSpotifyTab(<TabletView />);
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

    describe('left alone with nothing playing', () => {
      const minutes = (count: number) => act(() => vi.advanceTimersByTimeAsync(count * 60_000));
      const tab = (name: string) => screen.getByRole('tab', { name });
      beforeEach(() => {
        setPlayer({ playbackMode: 'browser', browserDeviceId: 'web-1', playbackState: null });
      });

      describe('with a backlight the Pi can set', () => {
        const BACKLIT = {
          ...fixture.config,
          brightness_control: true,
          display: { sleep_minutes: 15, brightness: 80, quiet_hours: { on: false, start: 22 * 60, end: 7 * 60 } }
        } as TouchscreenConfig;
        /** The percentages the kiosk was asked to set its backlight to, in order. */
        const backlights = (fetch: ReturnType<typeof vi.fn>) =>
          fetch.mock.calls
            .filter(([url]) => String(url).endsWith('/display/brightness'))
            .map(([, init]) => (JSON.parse((init as { body: string }).body) as { percent: number }).percent);

        it('sets it to the brightness setting, dims with it instead of darkening the page, and sets it again on waking', async () => {
          vi.useFakeTimers({ now: new Date('2026-01-01T12:00:00') });
          vi.spyOn(deviceConfig, 'loadDeviceConfig').mockResolvedValue(BACKLIT);
          const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
          vi.stubGlobal('fetch', fetch);
          renderOnSpotifyTab(<TabletView />);
          await minutes(1);
          expect(backlights(fetch)).toEqual([80]);
          await minutes(5);
          expect(screen.getByRole('dialog', { name: 'Dimmed screen' })).toHaveClass('sleep-screen-clear');
          expect(backlights(fetch)).toEqual([80, 24]);
          fireEvent.click(screen.getByRole('button', { name: 'Wake the screen' }));
          expect(backlights(fetch)).toEqual([80, 24, 80]);
        });

        it('keeps quiet hours on the server, and hands it the ones set on the kiosk before', async () => {
          vi.useFakeTimers({ now: new Date('2026-01-01T12:00:00') });
          const hours = { on: true, start: 23 * 60, end: 6 * 60 };
          localStorage.setItem('maxmix.quietHours', JSON.stringify(hours));
          const before = { ...BACKLIT, display: { sleep_minutes: 15, brightness: 80 } } as TouchscreenConfig;
          vi.spyOn(deviceConfig, 'loadDeviceConfig').mockResolvedValue(before);
          const save = vi
            .spyOn(deviceConfig, 'saveConfigSection')
            .mockImplementation((section, value) => Promise.resolve({ saved: { ...before, [section]: value } }));
          vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
          );
          renderOnSpotifyTab(<TabletView />);
          // The config loads, then the save waits out its debounce.
          await minutes(1);
          await minutes(1);
          expect(save).toHaveBeenCalledExactlyOnceWith('display', { ...before.display, quiet_hours: hours });
        });
      });

      it('shows the Dashboard after a minute, dims it five minutes later and sleeps after the chosen delay', async () => {
        vi.useFakeTimers({ now: new Date('2026-01-01T12:00:00') });
        localStorage.setItem('maxmix.screenSleep', '15');
        renderOnSpotifyTab(<TabletView />);
        await minutes(1);
        expect(tab('Dashboard')).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByRole('dialog', { name: 'Dimmed screen' })).not.toBeInTheDocument();
        await minutes(5);
        expect(screen.getByRole('dialog', { name: 'Dimmed screen' })).toBeInTheDocument();
        // The tap that brightens the screen lands on the overlay, not on the page behind it.
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Wake the screen' }));
        fireEvent.click(screen.getByRole('button', { name: 'Wake the screen' }));
        expect(screen.queryByRole('dialog', { name: 'Dimmed screen' })).not.toBeInTheDocument();
        expect(tab('Dashboard')).toHaveAttribute('aria-selected', 'true');
        await minutes(5);
        expect(screen.getByRole('dialog', { name: 'Dimmed screen' })).toBeInTheDocument();
        await minutes(14);
        expect(screen.queryByRole('dialog', { name: 'Sleep screen' })).not.toBeInTheDocument();
        await minutes(1);
        expect(screen.getByRole('dialog', { name: 'Sleep screen' })).toBeInTheDocument();
      });

      it('in quiet hours sleeps a minute after the last touch, even on another tab, and polls slowly until a tap wakes it', async () => {
        vi.useFakeTimers({ now: new Date('2026-01-01T23:00:00') });
        localStorage.setItem('maxmix.quietHours', JSON.stringify({ on: true, start: 22 * 60, end: 7 * 60 }));
        renderOnSpotifyTab(<TabletView />);
        showSettingsTab();
        await minutes(1);
        expect(screen.getByRole('dialog', { name: 'Sleep screen' })).toBeInTheDocument();
        expect(player.current.setSlowPolling).toHaveBeenLastCalledWith(true);
        fireEvent.click(screen.getByRole('button', { name: 'Wake the screen' }));
        expect(screen.queryByRole('dialog', { name: 'Sleep screen' })).not.toBeInTheDocument();
        expect(player.current.setSlowPolling).toHaveBeenLastCalledWith(false);
      });

      it('keeps the screen on and bright while music plays', async () => {
        vi.useFakeTimers({ now: new Date('2026-01-01T23:00:00') });
        localStorage.setItem('maxmix.quietHours', JSON.stringify({ on: true, start: 22 * 60, end: 7 * 60 }));
        setPlayer({
          playbackMode: 'browser',
          browserDeviceId: 'web-1',
          playbackState: { is_playing: true, item: track, device: { id: 'dev1', name: 'Soundbar' } }
        });
        renderOnSpotifyTab(<TabletView />);
        fireEvent.click(tab('Dashboard'));
        await minutes(30);
        expect(screen.queryByRole('dialog', { name: 'Dimmed screen' })).not.toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'Sleep screen' })).not.toBeInTheDocument();
      });
    });

    describe('when a newer version is out', () => {
      const fetchMock = vi.fn();
      /** GitHub's answer for a release whose Release workflow has uploaded the Pi bundle. */
      const release = (tag: string) =>
        Response.json({ tag_name: tag, assets: [{ name: 'the-max-mix-pi.tar.gz', state: 'uploaded' }] });
      beforeEach(() => {
        localStorage.setItem('maxmix.piVersion', 'v1.12.0 5a39e9a');
        fetchMock.mockReset();
        fetchMock.mockImplementation(() => Promise.resolve(release('v1.13.0')));
        vi.stubGlobal('fetch', fetchMock);
        resetFakeSockets();
        vi.stubGlobal('WebSocket', FakeWebSocket);
      });
      afterEach(() => vi.unstubAllGlobals());
      /** Quiet hours with nothing playing: the screen sleeps a minute after the last touch. */
      const sleepInAMinute = () => {
        vi.useFakeTimers({ now: new Date('2026-01-01T23:00:00') });
        localStorage.setItem('maxmix.quietHours', JSON.stringify({ on: true, start: 22 * 60, end: 7 * 60 }));
        setPlayer({ playbackMode: 'browser', browserDeviceId: 'web-1', playbackState: null });
      };

      it('asks once, and Not now keeps it quiet', async () => {
        const { unmount } = renderOnSpotifyTab(<TabletView />);
        expect(await screen.findByRole('dialog', { name: 'Update available' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
        expect(screen.queryByRole('dialog', { name: 'Update available' })).not.toBeInTheDocument();
        unmount();
        renderOnSpotifyTab(<TabletView />);
        await flush();
        expect(screen.queryByRole('dialog', { name: 'Update available' })).not.toBeInTheDocument();
      });

      it('Update now opens the update stream and the console in place of the tablet', async () => {
        renderOnSpotifyTab(<TabletView />);
        await screen.findByRole('dialog', { name: 'Update available' });
        fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
        expect(await screen.findByRole('dialog', { name: 'Updating the Pi' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'Update available' })).not.toBeInTheDocument();
        expect(latestFakeSocket().url).toBe('ws://127.0.0.1:7341/power/update');
        act(() => latestFakeSocket().receive({ type: 'log', line: '2026-11-04T20:00:00+0000 kiosk-pull[1]: hello' }));
        expect(screen.getByLabelText('Update output')).toHaveTextContent('kiosk-pull[1]: hello');
      });

      it('does not ask while the screen sleeps, but does once it wakes', async () => {
        sleepInAMinute();
        renderOnSpotifyTab(<TabletView />);
        await flush();
        expect(screen.getByRole('dialog', { name: 'Update available' })).toBeInTheDocument();
        // A dialog would show over the black sleep screen, so the question waits for the screen to wake.
        await act(() => vi.advanceTimersByTimeAsync(60_000));
        expect(screen.getByRole('dialog', { name: 'Sleep screen' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'Update available' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Wake the screen' }));
        await flush();
        expect(screen.getByRole('dialog', { name: 'Update available' })).toBeInTheDocument();
      });

      it('asks GitHub again each time Settings opens, and shows what it finds', async () => {
        renderOnSpotifyTab(<TabletView />);
        await screen.findByRole('dialog', { name: 'Update available' });
        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
        const asked = fetchMock.mock.calls.length;
        fetchMock.mockImplementation(() => Promise.resolve(release('v1.14.0')));
        fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
        openAbout();
        expect(await screen.findByText(/v1\.14\.0 is out\. Tap the button to install it now/)).toBeInTheDocument();
        expect(fetchMock.mock.calls.length).toBeGreaterThan(asked);
        // The newer version is asked about at once, over the open Settings.
        expect(screen.getByRole('dialog', { name: 'Update available' })).toBeInTheDocument();
        expect(screen.getByRole('tabpanel', { name: 'Settings' })).toBeInTheDocument();
      });

      it('Update now in the popup over Settings opens the console; Not now leaves Settings showing', async () => {
        renderOnSpotifyTab(<TabletView />);
        await screen.findByRole('dialog', { name: 'Update available' });
        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
        fetchMock.mockImplementation(() => Promise.resolve(release('v1.14.0')));
        fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
        await screen.findByRole('dialog', { name: 'Update available' });
        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
        expect(screen.queryByRole('dialog', { name: 'Update available' })).not.toBeInTheDocument();
        expect(screen.getByRole('tabpanel', { name: 'Settings' })).toBeInTheDocument();

        // The next one (v1.15.0) is accepted: the console opens over Settings.
        fetchMock.mockImplementation(() => Promise.resolve(release('v1.15.0')));
        fireEvent.click(screen.getByRole('tab', { name: 'Spotify' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
        const popup = await screen.findByRole('dialog', { name: 'Update available' });
        fireEvent.click(within(popup).getByRole('button', { name: 'Update now' }));
        expect(await screen.findByRole('dialog', { name: 'Updating the Pi' })).toBeInTheDocument();
      });

      it('Check for updates in Settings asks again after Not now, and the update starts from the popup', async () => {
        renderOnSpotifyTab(<TabletView />);
        await screen.findByRole('dialog', { name: 'Update available' });
        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
        openAbout();
        // The same version was declined, so opening Settings only says it is out.
        expect(await screen.findByText(/v1\.13\.0 is out\. Tap the button to install it now/)).toBeInTheDocument();
        await flush();
        expect(screen.queryByRole('dialog', { name: 'Update available' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
        const popup = await screen.findByRole('dialog', { name: 'Update available' });
        fireEvent.click(within(popup).getByRole('button', { name: 'Update now' }));
        expect(await screen.findByRole('dialog', { name: 'Updating the Pi' })).toBeInTheDocument();
      });

      it('asks GitHub again when the screen wakes', async () => {
        sleepInAMinute();
        fetchMock.mockImplementation(() => Promise.resolve(release('v1.12.0')));
        renderOnSpotifyTab(<TabletView />);
        await flush();
        expect(screen.queryByRole('dialog', { name: 'Update available' })).not.toBeInTheDocument();
        await act(() => vi.advanceTimersByTimeAsync(60_000));
        expect(screen.getByRole('dialog', { name: 'Sleep screen' })).toBeInTheDocument();
        // A newer release comes out while the screen is off.
        fetchMock.mockImplementation(() => Promise.resolve(release('v1.13.0')));
        const asked = fetchMock.mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: 'Wake the screen' }));
        await flush();
        expect(screen.getByRole('dialog', { name: 'Update available' })).toBeInTheDocument();
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
      const view = renderOnSpotifyTab(<TabletView />);
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

  it('shows the clock in the bar on the Spotify tab', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T09:05:00') });
    renderOnSpotifyTab(<TabletView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(defined(document.querySelector('.floating-bar .dashboard-clock'))).toHaveTextContent(/9:05|09:05/);
  });
});
