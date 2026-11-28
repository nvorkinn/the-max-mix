import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { crossfade } from '../utils/crossfade';
import { useSpotifyPlayer } from '../hooks/useSpotifyPlayer';
import { useAlongVolume } from '../hooks/useAlongVolume';
import { useSonosPlayer } from '../hooks/useSonosPlayer';
import { useSpotifyCooldown } from '../hooks/useSpotifyCooldown';
import { useKioskUpdate } from '../hooks/useKioskUpdate';
import { useSpotifyPolling } from '../hooks/useSpotifyPolling';
import { useDeviceConfig } from '../hooks/useDeviceConfig';
import { startNextAsleep, useScreenSleep } from '../hooks/useScreenSleep';
import { useAutoSwitch } from '../hooks/useAutoSwitch';
import { IDLE_DASHBOARD_MS, useIdle } from '../hooks/useIdle';
import { useWifiAtStart } from '../hooks/useWifiAtStart';
import { reloadApp } from '../utils/reloadApp';
import { usePanelView } from '../hooks/usePanelView';
import type { LyricsAvailability, PanelView } from '../hooks/usePanelView';
import { useLyrics } from '../hooks/useLyrics';
import type { LyricsLookup } from '../hooks/useLyrics';
import { extractArtColours, type ArtColours } from '../utils/colorExtractor';
import { useIsOffline } from '../hooks/useOnlineStatus';
import { errorMessage } from '../utils/errorMessage';
import { getQueue } from '../spotify/api';
import { peopleOnKiosk, switchPerson, takePhoneToPair } from '../spotify/auth';
import { reloadSettings } from '../spotify/settings';
import { getKioskSonosLeader, playOnSonosRoom } from '../sonos/kiosk';
import { rememberSpeaker } from '../spotify/knownDevices';
import { getSpotifyRetryDelay, recordSpotifyRetryAfter, SpotifyApiError } from '../spotify/http';
import { useSpeakerSelection } from '../speakers/useSpeakerSelection';
import { isKiosk } from '../utils/kiosk';
import { debugLog } from '../utils/debugLog';
import {
  BRIGHTNESS_MAX,
  brightnessOf,
  dimmedBrightness,
  quietDimmedBrightness,
  setBacklight
} from '../utils/backlight';
import { loadQuietHours, isQuietTime, saveQuietHours } from '../utils/quietHours';
import type { QuietHours } from '../utils/quietHours';
import { setLyricsStyle } from '../utils/lyricsStyle';
import { getScreenSleep, setScreenSleep } from '../utils/screenSleep';
import type { ScreenSleepMinutes } from '../utils/screenSleep';
import {
  basePalette,
  dynamicPalette,
  isOldDynamic,
  loadDynamicColour,
  loadThemeColour,
  saveDynamicColour,
  saveThemeColour,
  toThemeColour
} from '../utils/themeColour';
import { useLights } from '../hooks/useLights';
import { DYNAMIC_LINGER_MS, useLingers } from '../hooks/useLingers';
import { usePodcastPlayer } from '../hooks/usePodcastPlayer';
import { usePodcasts, usePodcastsTab } from '../hooks/usePodcasts';
import { DEFAULT_CLOCK_FORMAT } from '../utils/clockFormat';
import { DEFAULT_LANGUAGE, LanguageContext, LOCALES } from '../i18n/language';
import type { Language } from '../i18n/language';
import { translate } from '../i18n/translate';
import type { PlayingOn } from '../speakers/useSpeakerSelection';
import type { ThemeColour } from '../utils/themeColour';
import type { MusicChoice, Track } from '../types';
import type { TabBarProps, TabId } from '../dashboard/props';
import { nowPlayingCard, PAUSED_SHOWN_MS } from '../dashboard/nowPlaying';
import { useReportProblem } from '../problems/problems';
import AlbumArtPlayer from './AlbumArtPlayer';
import SpotifySetup from './SpotifySetup';
import TrackQueue, { type QueueStatus } from './TrackQueue';
import { describePlayback, PlayerProblem, type PlaybackNoticeState, type PlayerNotice } from './PlaybackNotice';
import LightsView from './LightsView';
import LyricsPanel from './LyricsPanel';
import PodcastsView from './PodcastsView';
import PanelNav from './PanelNav';
import SettingsPanel from './SettingsPanel';
import type { SettingsSection } from './SettingsPanel';
import UpdateConsole from './UpdateConsole';
import UpdatePrompt from './UpdatePrompt';
import SpeakersView from './SpeakersView';
import MusicPicker from './MusicPicker';
import DebugConsole from './DebugConsole';
import SleepScreen from './SleepScreen';
import PairPhoneSheet from './PairPhoneSheet';
import { tabPanelId } from './AppTabs';
import DashboardScreen from './DashboardScreen';
import TabBackdrop from './TabBackdrop';
import TabBar from './dashboard/TabBar';

/** The minute it is now; the tab bar's clock changes only when this does. */
const currentMinute = () => Math.floor(Date.now() / 60_000);

// While the kiosk's player is active and lists its queue itself the Web API is not asked at all; while it is active
// without a list, the queue is re-read when it says the queue changed, and this is only a safety net.
const QUEUE_POLL_MS = 10_000;
/** How long the Speakers view stays after a choice is saved, before the panel goes back to the lyrics or queue. */
const SPEAKERS_SAVED_SHOWN_MS = 5000;
const PLAYER_QUEUE_POLL_MS = 20_000;

/** Writes `message` to the debug log each time it changes to a new, non-empty value. */
function useLogChanges(message: string | null | undefined, source: string) {
  useEffect(() => {
    if (message) debugLog('error', source, message);
  }, [message, source]);
}

/** Dynamic's colours: the cover's while it plays, else what shows with Dynamic off. */
function coverOrChosenPalette(art: ArtColours | null, colour: ThemeColour) {
  return art ? dynamicPalette(art.dominant) : basePalette(colour);
}

/** What the player names as playing, in `language`. */
function playingOnLabel(playing: PlayingOn | undefined, language: Language): string | undefined {
  if (!playing) return undefined;
  if ('name' in playing) return playing.name;
  if ('tablet' in playing) return translate('speakers.this_tablet', language);
  return translate('speakers.count', language, { count: playing.speakers });
}

/** Whether the song has lyrics to open the panel on; an instrumental, a failed lookup or no song counts as none. */
function lyricsAvailability({ status, lyrics }: LyricsLookup): LyricsAvailability {
  if (status === 'loading') return 'unknown';
  return status === 'ready' && lyrics?.kind !== 'instrumental' ? 'found' : 'none';
}

export default function TabletView() {
  const {
    isReady,
    playbackState,
    isAuthenticated,
    isLoading,
    isConnecting,
    playbackMode,
    browserDeviceId,
    isPlayerActive,
    queueVersion,
    describeCurrentTrack,
    kioskQueue: playerQueue,
    error: playerError,
    problem: playerProblem,
    retryPlayback,
    reconnectPlayer,
    togglePlay,
    nextTrack,
    skipAhead,
    previousTrack,
    seek,
    setVolume,
    toggleShuffle,
    cycleRepeat,
    transferPlayback,
    handOff,
    playMusic: playMusicOnSpotify,
    setSlowPolling
  } = useSpotifyPlayer();
  const sonos = useSonosPlayer();
  const followingSonos = sonos.active;
  // What the tablet shows: the Sonos group the kiosk plays on, or else Spotify's playback.
  const shownPlayback = followingSonos ? sonos.playback : playbackState;
  const error = playerError;
  const isOffline = useIsOffline(playerError);
  // While a Sonos plays, Spotify's queue is not what plays next; the Sonos says its next song itself.
  const canPollQueue = isAuthenticated && !followingSonos;
  // While the kiosk's player (Soloist) is signed in and the active device, it lists the whole queue itself, at every
  // change; the Web API is only polled without that list. Soloist's queue is its own, not the playing device's, so while
  // another device plays the Web API's is used.
  const kioskQueue = canPollQueue ? playerQueue : null;
  const hasKioskQueue = Boolean(kioskQueue);
  const spotifyRetryAt = useSpotifyCooldown();
  const waitingForSpotify = spotifyRetryAt > 0;
  const { enabled: pollEnabled, quotaExceeded } = useSpotifyPolling();

  const [queue, setQueue] = useState<Track[]>([]);
  const [queueStatus, setQueueStatus] = useState<QueueStatus>(canPollQueue ? 'loading' : 'idle');
  const [queueRequestVersion, setQueueRequestVersion] = useState(0);
  const [isRefreshingPlayback, setIsRefreshingPlayback] = useState(false);
  // True while a tapped queue song is being skipped to, so a second tap cannot start another jump.
  const [isJumping, setIsJumping] = useState(false);
  const [minute, setMinute] = useState(currentMinute);
  // The Settings tab starts on its first page; the sign-in prompts bring it up on the Spotify page.
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>();
  const [isMusicOpen, setIsMusicOpen] = useState(false);
  // Every start (kiosk start, reload, coming back from a sign-in) opens on the Dashboard, except after a failed sign-in,
  // whose message the Spotify tab shows.
  const [screen, setScreen] = useState<TabId>('dashboard');
  // Every change of tab fades across the whole screen, whether tapped, idle or from a prompt.
  const goToScreen = (next: TabId) => crossfade(() => setScreen(next));
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  // AirPlay, Bluetooth and Sonos need the Pi's server, so they are offered on the kiosk only.
  const [onKiosk] = useState(isKiosk);
  // Someone who has just signed in with no phone linked: the kiosk offers to pair theirs straight away.
  const [pairingFor] = useState(() => (onKiosk ? takePhoneToPair() : null));
  const [isPairingOpen, setIsPairingOpen] = useState(pairingFor !== null);

  // Spotify will not move its playback to a Sonos, so on the kiosk the Pi starts the song on the speaker itself
  // (sonos-ts), with Spotify's queue after it and from where the song was. The tablet is paused first, while it is still
  // the player (afterwards Spotify has moved on and a pause fails), and its player lets go. From then on the tablet shows
  // and controls the Sonos group (useSonosPlayer), which SonosKioskList marks as the kiosk's. Picking another Sonos while
  // following one plays the Sonos's song there, from the same point. The Speakers view's Save calls it (useSpeakerSelection).
  const playOnSonos = async (room: string) => {
    const shown = sonos.active ? sonos.playback : playbackState;
    const uri = shown?.item?.uri;
    if (!uri) throw new Error(translate('spotify_tab.sonos_first', language));
    const positionMs = shown.progress_ms ?? 0;
    if (sonos.active) {
      // The Pi carries over the queue of the Sonos group the music moves from.
      await playOnSonosRoom(room, uri, { positionMs, queueFrom: getKioskSonosLeader() });
      return;
    }
    // The queue as it is now: the kiosk player's, every song of it, or else Spotify's (about 20 songs), as the one on
    // screen may be a few seconds old, or not read at all.
    const upcoming =
      kioskQueue ??
      (await getQueue()
        .then(reply => reply.queue)
        .catch(() => queue));
    if (playbackState?.is_playing && !(await togglePlay())) debugLog('warn', 'sonos', 'Spotify did not pause');
    const next = upcoming.map(track => track.uri).filter((song): song is string => Boolean(song));
    await playOnSonosRoom(room, uri, { next, positionMs });
    await handOff();
  };

  // Music picked while a Sonos plays goes to the Sonos (a song, album or playlist; Liked Songs cannot).
  const playMusic = (choice: MusicChoice) => {
    goToScreen('spotify');
    return sonos.active ? sonos.play(choice.uri) : playMusicOnSpotify(choice);
  };

  // Colours read from the album art, which Dynamic follows.
  const [artColours, setArtColours] = useState<ArtColours | null>(null);

  // Spotify's device list can leave out a speaker that plays (Sonos does), so the drawer remembers each one seen playing.
  const playingDevice = playbackState?.device;
  useEffect(() => {
    rememberSpeaker(playingDevice);
    if (playingDevice) debugLog('info', 'playing device', JSON.stringify(playingDevice));
  }, [playingDevice]);
  const isPlaying = Boolean(shownPlayback?.is_playing);
  const currentTrack = shownPlayback?.item;
  // The Podcasts tab's episodes play in the page, through the same speakers as Spotify (the Pi routes Chromium's sound
  // as it routes Soloist's), so only one plays at a time: an episode starting pauses the music this tablet plays (itself
  // or its Sonos), as a person switch does, and the music starting pauses the episode.
  const pauseMusicRef = useRef<() => void>(() => {});
  const podcastPlayer = usePodcastPlayer(() => pauseMusicRef.current());
  const pausePodcast = podcastPlayer.pause;
  const musicWasPlayingRef = useRef(isPlaying);
  useEffect(() => {
    if (isPlaying && !musicWasPlayingRef.current) pausePodcast();
    musicWasPlayingRef.current = isPlaying;
  }, [isPlaying, pausePodcast]);
  const listening = isPlaying || podcastPlayer.isPlaying;

  // Left alone with nothing playing, the kiosk shows the Dashboard, which dims after a while and then sleeps the chosen
  // minutes later (see useScreenSleep). The screen stays on and bright while music plays. In quiet hours it sleeps a
  // minute after the last touch, on any tab, and a screen with a backlight fades well down five seconds after
  // the touch.
  // A kiosk that starts with no network opens on Settings › Wi-Fi, and stays there (rather than going idle to the
  // Dashboard) until it is on one, joined there or back by itself; then it goes to the Dashboard.
  const needsWifi = useWifiAtStart(onKiosk, {
    onNeeded: () =>
      crossfade(() => {
        setSettingsSection('wifi');
        setScreen('settings');
      }),
    // Started without a network, so the Spotify player and the Dashboard's data failed to load: start again.
    onConnected: reloadApp
  });
  // A phone giving the kiosk its Wi-Fi (Settings › Wi-Fi › Hotspot) takes minutes with nobody touching the
  // screen, so the kiosk stays on Settings, awake, until it is done.
  const [isPhoneSetup, setIsPhoneSetup] = useState(false);
  useIdle({
    enabled: onKiosk,
    busy: listening || needsWifi || isPhoneSetup,
    idleMs: IDLE_DASHBOARD_MS,
    onIdle: () => goToScreen('dashboard')
  });
  // Once someone owns the kiosk, countdown-server's config is its colour, screen sleep and lyrics: the settings save there,
  // and whatever the config says (a change here, one undone, or the server's latest) shows, and is kept locally for
  // starts without the server. Before that the kiosk keeps its own.
  const deviceConfig = useDeviceConfig();
  const ownedConfig = deviceConfig.owned ? deviceConfig.config : null;
  const style = ownedConfig?.style;
  // The language everything on the tablet is in, and the page's own (lang), which Chromium's hyphenation and voices go by.
  const language = ownedConfig?.language ?? DEFAULT_LANGUAGE;
  useEffect(() => {
    document.documentElement.lang = LOCALES[language];
  }, [language]);
  const display = ownedConfig?.display;
  // The time format applies across the tablet: the tab bar's clock and the Dashboard's times.
  const clockFormat = ownedConfig?.clock_format ?? DEFAULT_CLOCK_FORMAT;
  const [localScreenSleep, setLocalScreenSleep] = useState(getScreenSleep);
  const [localThemeColour, setLocalThemeColour] = useState(loadThemeColour);
  const screenSleepMinutes = display?.sleep_minutes ?? localScreenSleep;
  const themeColour = style ? toThemeColour(style.colour) : localThemeColour;
  // Dynamic, on or off, beside the colour. The server's config can still say the old Dynamic colour, which turns it on
  // over the default colour.
  const [localDynamic, setLocalDynamic] = useState(loadDynamicColour);
  const dynamicColour = style ? style.dynamic || isOldDynamic(style.colour) : localDynamic;
  // With Dynamic on, the colours follow the album art while music plays, and fade back to the chosen colour once it
  // has stopped for a while.
  const liveArt = useLingers(isPlaying, DYNAMIC_LINGER_MS) ? artColours : null;
  const dynamicVars = dynamicColour ? coverOrChosenPalette(liveArt, themeColour) : undefined;
  useEffect(() => {
    if (!style) return;
    saveThemeColour(toThemeColour(style.colour));
    saveDynamicColour(style.dynamic || isOldDynamic(style.colour));
  }, [style]);
  useEffect(() => {
    if (display) setScreenSleep(display.sleep_minutes);
  }, [display]);
  // The lyrics' size and alignment: the server's once someone owns the kiosk (Settings > Spotify saves them there),
  // kept locally for starts without it.
  const lyricsLook = ownedConfig?.lyrics;
  useEffect(() => {
    if (lyricsLook) setLyricsStyle(lyricsLook);
  }, [lyricsLook]);
  const changeThemeColour = (colour: ThemeColour) => {
    if (style) {
      // Over the old Dynamic colour, Dynamic stays on.
      deviceConfig.save('style', { ...style, colour, dynamic: dynamicColour });
      return;
    }
    setLocalThemeColour(colour);
    saveThemeColour(colour);
  };
  const changeDynamicColour = (on: boolean) => {
    if (style) {
      deviceConfig.save('style', { ...style, colour: themeColour, dynamic: on });
      return;
    }
    setLocalDynamic(on);
    saveDynamicColour(on);
  };
  const changeScreenSleep = (minutes: ScreenSleepMinutes) => {
    if (display) {
      deviceConfig.save('display', { ...display, sleep_minutes: minutes });
      return;
    }
    setLocalScreenSleep(minutes);
    setScreenSleep(minutes);
  };
  // Quiet hours: the server's once someone owns the kiosk, kept locally for starts without it. Hours set on the kiosk
  // before the server kept them are handed to it once.
  const [localQuietHours, setLocalQuietHours] = useState(loadQuietHours);
  const serverQuietHours = display?.quiet_hours;
  const quietHours = serverQuietHours ?? localQuietHours;
  useEffect(() => {
    if (serverQuietHours) saveQuietHours(serverQuietHours);
  }, [serverQuietHours]);
  const saveConfigSection = deviceConfig.save;
  const hasHandedQuietHoursRef = useRef(false);
  useEffect(() => {
    if (!display || display.quiet_hours || !localQuietHours.on || hasHandedQuietHoursRef.current) return;
    hasHandedQuietHoursRef.current = true;
    saveConfigSection('display', { ...display, quiet_hours: localQuietHours });
  }, [display, localQuietHours, saveConfigSection]);
  const changeQuietHours = (hours: QuietHours) => {
    // Kept locally too, so the change holds with a server that predates quiet hours and answers without them.
    setLocalQuietHours(hours);
    saveQuietHours(hours);
    if (display) deviceConfig.save('display', { ...display, quiet_hours: hours });
  };
  // The brightness setting, on a kiosk whose panel has a backlight the Pi can set (utils/backlight).
  const hasBacklight = onKiosk && ownedConfig?.brightness_control === true;
  // The Podcasts tab, while the owner has NRK linked and hasn't switched it off; its shows are read while it is open.
  const hasPodcasts = usePodcastsTab(ownedConfig);
  // A kiosk whose Podcasts tab was taken away while it was open goes back to the Dashboard.
  if (screen === 'podcasts' && !hasPodcasts) setScreen('dashboard');
  const podcasts = usePodcasts(screen === 'podcasts');
  // The lights the owner let this kiosk switch (Home Assistant's, through the Pi's service); most kiosks have none.
  const lights = useLights(onKiosk, ownedConfig);
  const hasLights = lights.status !== null && lights.status.state !== 'off';
  // A kiosk whose lights were taken away while their tab was open goes back to the Dashboard.
  if (screen === 'lights' && !hasLights) setScreen('dashboard');
  const brightness = display ? brightnessOf(display) : BRIGHTNESS_MAX;
  const changeBrightness = (percent: number) => {
    if (display) deviceConfig.save('display', { ...display, brightness: percent });
  };
  const kioskUpdate = useKioskUpdate(onKiosk);
  const quiet = isQuietTime(quietHours, new Date(minute * 60_000));
  const sleep = useScreenSleep({
    enabled: onKiosk,
    keepAwake: listening || isPhoneSetup,
    onDashboard: screen === 'dashboard',
    sleepMs: screenSleepMinutes === 0 ? null : screenSleepMinutes * 60_000,
    quiet,
    backlit: hasBacklight
  });
  // Waking the screen checks the update channel again for a newer version: someone is back, and hours may have passed.
  const checkForUpdate = kioskUpdate.checkNow;
  const wasAsleepRef = useRef(false);
  useEffect(() => {
    if (wasAsleepRef.current && !sleep.asleep) checkForUpdate();
    wasAsleepRef.current = sleep.asleep;
  }, [sleep.asleep, checkForUpdate]);
  // A sleeping screen has no one watching it, so Spotify is asked about it less often (see ASLEEP_POLL_MS).
  // While a Sonos plays, Spotify is only watched in case it starts playing somewhere else, so it is asked less often too.
  const setSonosSlowPolling = sonos.setSlowPolling;
  useEffect(() => {
    setSlowPolling(sleep.asleep || followingSonos);
    setSonosSlowPolling(sleep.asleep);
  }, [sleep.asleep, followingSonos, setSlowPolling, setSonosSlowPolling]);
  // The backlight follows the setting, faded down while the screen is dimmed (further in quiet hours). Asleep,
  // the Pi turns the output off, and waking sets the backlight again, at once.
  let backlight = brightness;
  if (sleep.dimmed) backlight = quiet ? quietDimmedBrightness(brightness) : dimmedBrightness(brightness);
  useEffect(() => {
    if (hasBacklight && !sleep.asleep) setBacklight(backlight, sleep.dimmed);
  }, [hasBacklight, backlight, sleep.asleep, sleep.dimmed]);
  let screenState = 'Awake';
  if (sleep.asleep) screenState = 'Asleep';
  else if (sleep.dimmed) screenState = 'Dimmed';
  const screenStatus = `${screenState}, wake lock ${sleep.wakeLock}`;

  // Problems go to the debug console.
  useLogChanges(playerError, 'player');
  useLogChanges(queueError, 'queue');
  useLogChanges(sonos.error, 'sonos');

  // Ctrl+Shift+D opens the debug console too, for a browser with a keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setIsDebugOpen(open => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setMinute(currentMinute()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Drop the queue and its error as soon as polling stops (adjusted during render, not in an effect).
  const [couldPollQueue, setCouldPollQueue] = useState(canPollQueue);
  if (couldPollQueue !== canPollQueue) {
    setCouldPollQueue(canPollQueue);
    setQueueStatus(canPollQueue ? 'loading' : 'idle');
    if (!canPollQueue) {
      setQueue([]);
      setQueueError(null);
    }
  }

  useEffect(() => {
    // The queue is not shown while the screen sleeps; waking it reads the queue again at once.
    // Wait for the first playback read so its track and playing state do not immediately restart queue polling.
    if (quotaExceeded || !canPollQueue || hasKioskQueue || isLoading || sleep.asleep) return;
    let cancelled = false;
    // Read through a function: TypeScript narrows the flag to `false` and cannot see the cleanup flip it mid-await.
    const isCancelled = () => cancelled;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const base = isPlayerActive ? PLAYER_QUEUE_POLL_MS : QUEUE_POLL_MS;
    const poll = async () => {
      const retryWait = getSpotifyRetryDelay();
      if (retryWait > 0) {
        timer = setTimeout(() => void poll(), retryWait);
        return;
      }
      setQueueStatus('loading');
      let delay = base;
      try {
        const data = await getQueue();
        if (isCancelled()) return;
        setQueue(data.queue);
        // The reply names the song that plays too, which the kiosk's player can leave without its name.
        describeCurrentTrack(data.currently_playing ?? null);
        setQueueStatus('ready');
        setQueueError(null);
        failures = 0;
      } catch (caught) {
        if (isCancelled()) return;
        setQueueError(errorMessage(caught));
        setQueueStatus('error');
        if (caught instanceof SpotifyApiError) recordSpotifyRetryAfter(caught);
        delay = Math.max(Math.min(60_000, base * 2 ** ++failures), getSpotifyRetryDelay());
      }
      // Nothing playing means nothing moves through the queue; playing again or a new track reads it at once.
      if (isPlaying && pollEnabled && !isCancelled()) timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    currentTrack?.id,
    canPollQueue,
    hasKioskQueue,
    isLoading,
    sleep.asleep,
    quotaExceeded,
    pollEnabled,
    isPlayerActive,
    isPlaying,
    queueVersion,
    queueRequestVersion,
    describeCurrentTrack
  ]);

  const artUrl = currentTrack?.album?.images?.[0]?.url;
  useEffect(() => {
    let current = true;
    void extractArtColours(artUrl).then(colours => {
      // A slow read for the previous song must not replace the colours of the one now playing.
      if (current) setArtColours(colours);
    });
    return () => {
      current = false;
    };
  }, [artUrl]);

  const showScreen = (next: TabId) => {
    crossfade(() => {
      if (next === 'settings' && screen !== 'settings') setSettingsSection(undefined);
      setScreen(next);
    });
  };
  const activePerson = peopleOnKiosk().find(person => person.active);
  const openSettingsOn = (section: SettingsSection) => {
    crossfade(() => {
      setSettingsSection(section);
      setScreen('settings');
    });
  };
  const showSettings = () => openSettingsOn('spotify');
  // Switching person: the music this tablet plays (itself, or its Sonos) belongs to the person leaving, so it pauses;
  // then the page starts again as the new person. A pause that fails or hangs does not hold the switch up.
  const switchTo = async (spotifyId: string) => {
    if (isPlaying && (followingSonos || isPlayerActive)) {
      const pause = followingSonos ? sonos.togglePlay() : togglePlay();
      await Promise.race([pause.catch(() => false), new Promise(resolve => setTimeout(resolve, 3000))]);
    }
    switchPerson(spotifyId);
    reloadSettings();
  };
  // An episode starting pauses the music this tablet plays; music on another Spotify device plays on.
  const pauseMusic = () => {
    if (!isPlaying || !(followingSonos || isPlayerActive)) return;
    void (followingSonos ? sonos.togglePlay() : togglePlay()).catch(() => false);
  };
  useEffect(() => {
    pauseMusicRef.current = pauseMusic;
  });
  // Left alone a while, the kiosk switches to whoever's phone it hears when the active person's has gone. A switch made
  // while the screen sleeps starts the new page asleep too, so nobody's screen lights up at night.
  useAutoSwitch({
    enabled: onKiosk && isAuthenticated,
    asleep: sleep.asleep,
    dimmed: sleep.dimmed,
    isPlaying,
    isBusy: isMusicOpen,
    onSwitch: (spotifyId, asleep) => {
      if (asleep) startNextAsleep();
      void switchTo(spotifyId);
    }
  });
  const recoverPlayback = async (action: () => Promise<boolean>) => {
    if (isRefreshingPlayback) return;
    setIsRefreshingPlayback(true);
    try {
      await action();
    } finally {
      setIsRefreshingPlayback(false);
    }
  };
  const problem = playerProblem;
  const needsConnection = !isLoading && (!isAuthenticated || problem?.recovery === 'sign-in');
  const restricted = Boolean(playbackState?.device?.is_restricted);
  let notice: PlaybackNoticeState | null = null;
  if (isOffline) notice = { kind: 'offline' };
  else if (!isAuthenticated) notice = { kind: 'signed-out' };
  else if (followingSonos && problem?.recovery !== 'sign-in') {
    // Spotify has let go of the music, so its own problems (no player, a restricted device) are not this screen's.
    if (sonos.error) notice = { kind: 'problem', problem: { message: sonos.error, recovery: 'refresh' } };
  } else if (restricted) notice = { kind: 'restricted' };
  else if (problem?.recovery === 'sign-in') notice = { kind: 'problem', problem };
  else if (quotaExceeded) {
    notice = { kind: 'problem', problem: { message: translate('spotify_tab.quota', language), recovery: 'quota' } };
  } else if (waitingForSpotify) {
    notice = {
      kind: 'problem',
      problem: { message: playerError || translate('spotify_tab.wait', language), recovery: 'wait' }
    };
  } else if (problem) {
    const recovery = problem.recovery === 'wait' ? 'refresh' : problem.recovery;
    notice = { kind: 'problem', problem: { ...problem, recovery } };
  } else if (isLoading || (!isReady && isConnecting)) notice = { kind: 'connecting' };
  else if (!isReady && !browserDeviceId) notice = { kind: 'no-device' };
  else if (!currentTrack) notice = { kind: 'idle' };
  // Only trouble needing the user's attention is said, in the player and in the warning list; idle and connecting states
  // are the player's own.
  let playerNotice: PlayerNotice | null = null;
  if (!needsConnection && notice?.kind === 'problem') playerNotice = notice;
  else if (!needsConnection && notice?.kind === 'restricted') playerNotice = { kind: 'restricted' };
  const spotifyControlsEnabled =
    isAuthenticated &&
    !isOffline &&
    (isReady || Boolean(browserDeviceId)) &&
    !restricted &&
    (!waitingForSpotify || isPlayerActive) &&
    !isLoading;
  const controlsEnabled = followingSonos
    ? isAuthenticated && !isOffline && Boolean(sonos.playback)
    : spotifyControlsEnabled;
  let shownQueueStatus: QueueStatus = waitingForSpotify ? 'waiting' : queueStatus;
  // Neither the Sonos's queue nor the kiosk player's waits for the Web API.
  if (followingSonos || kioskQueue) shownQueueStatus = 'ready';
  const shownQueue = followingSonos ? sonos.next : (kioskQueue ?? queue);
  const shownQueueError = followingSonos || kioskQueue ? null : queueError;
  const trackKey = currentTrack?.id ?? currentTrack?.uri ?? null;
  // The song's lyrics are looked up as it starts, even with the panel on the queue, so the panel can open on them.
  const lyrics = useLyrics(currentTrack, !needsConnection);
  const panel = usePanelView(lyricsAvailability(lyrics), shownPlayback?.is_playing === true, trackKey);
  const lyricsShown = panel.view === 'lyrics';
  // Tapping Lyrics while the lyrics show starts sync mode for the song playing; it ends with a tap on a line, another tap
  // on Lyrics, another view or another song.
  const [syncingTrack, setSyncingTrack] = useState<string | null>(null);
  const lyricsSyncing = lyricsShown && trackKey !== null && syncingTrack === trackKey;
  const showPanel = (next: PanelView) => {
    if (next === 'lyrics' && lyricsShown) {
      setSyncingTrack(lyricsSyncing ? null : trackKey);
      return;
    }
    setSyncingTrack(null);
    panel.show(next);
  };
  const speakersShown = panel.view === 'speakers';
  const chooseSpeaker = () => showPanel('speakers');
  const speakers = useSpeakerSelection({
    onKiosk,
    open: speakersShown && !needsConnection,
    browserDeviceId: browserDeviceId ?? null,
    playingDeviceId: playbackState?.device?.id ?? null,
    sonosName: sonos.name ?? null,
    transfer: transferPlayback,
    playOnSonos,
    leaveSonos: sonos.leave,
    setTabletVolume: setVolume
  });
  // While Sonos rooms play along with this tablet, its slider moves their volume (useAlongVolume).
  const along = useAlongVolume(onKiosk && !followingSonos ? speakers.alongRoom : null);
  const alongVolume = along.volume;
  const playerPlayback =
    alongVolume !== null && shownPlayback?.device
      ? { ...shownPlayback, device: { ...shownPlayback.device, volume_percent: alongVolume, supports_volume: true } }
      : shownPlayback;
  // Once a choice is saved there is nothing left to do in the Speakers view, so a moment later the panel goes back to its
  // own view. Another change, or another view tapped meanwhile, calls that off.
  const [speakersSaved, setSpeakersSaved] = useState(false);
  const showDefaultPanel = panel.showDefault;
  // Adjusted during render, like the panel's own view (usePanelView), not in an effect.
  if (speakersSaved && (!speakersShown || speakers.dirty)) setSpeakersSaved(false);
  useEffect(() => {
    if (!speakersSaved) return;
    const timer = setTimeout(() => {
      setSpeakersSaved(false);
      showDefaultPanel();
    }, SPEAKERS_SAVED_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [speakersSaved, showDefaultPanel]);
  const saveSpeakers = async () => {
    if (await speakers.save()) setSpeakersSaved(true);
  };
  // While the Speakers view shows a changed choice, the buttons save or cancel it; elsewhere they switch the view.
  let speakersButton: 'speakers' | 'save' | 'saving' = 'speakers';
  if (speakersShown && speakers.saving) speakersButton = 'saving';
  else if (speakersShown && speakers.dirty) speakersButton = 'save';
  /** Plays the queue song at this position by skipping past the ones before it. */
  const playQueueTrack = async (index: number) => {
    setIsJumping(true);
    try {
      await (followingSonos ? sonos.skipAhead(index + 1) : skipAhead(index + 1));
    } finally {
      setIsJumping(false);
    }
  };

  // The song playing, in a card under the Dashboard's clock: there while it plays, and a while after a pause.
  const songShown = useLingers(isPlaying, PAUSED_SHOWN_MS) && !needsConnection;
  const nowPlaying = nowPlayingCard(shownPlayback, {
    controlsEnabled,
    onPlayPause: followingSonos ? sonos.togglePlay : togglePlay,
    onNext: followingSonos ? sonos.nextTrack : nextTrack
  });

  // The Dashboard's tab bar, which floats on the Spotify and Settings tabs too. Search is the Spotify tab's alone: the
  // Dashboard and Settings bars drop it.
  const tabBar: TabBarProps = {
    active: screen,
    onSelect: showScreen,
    person: activePerson ? { name: activePerson.name, pictureUrl: activePerson.imageUrl || null } : null,
    onSearch: needsConnection ? null : () => setIsMusicOpen(true),
    now: new Date(minute * 60_000),
    clockFormat,
    // Every tab's bar shows the signed-in person's face, so tapping it switches person on every tab.
    onSwitchPerson: isAuthenticated ? spotifyId => void switchTo(spotifyId) : null,
    // Holding the clock opens the debug console, on every tab.
    onClockHold: () => setIsDebugOpen(true),
    hasPodcasts,
    hasLights
  };

  // A playback problem is listed under the tab bar's warning, and one with a fix is said in the player too, in the
  // speaker's place. Waiting or a used-up quota has nothing to tap, so the speaker stays.
  const playbackProblem =
    playerNotice &&
    describePlayback(playerNotice, (id, args) => translate(id, language, args), {
      onSettings: showSettings,
      onChooseSpeaker: chooseSpeaker,
      onRefresh: followingSonos ? sonos.refresh : () => void recoverPlayback(retryPlayback),
      onReconnect: reconnectPlayer
    });
  useReportProblem('playback', playbackProblem && { ...playbackProblem, busy: isRefreshingPlayback });
  // No internet goes under the warning with the rest; only the kiosk has Wi-Fi settings.
  useReportProblem(
    'offline',
    isOffline
      ? {
          title: translate('offline.title', language),
          action: onKiosk
            ? { label: translate('offline.wifi', language), run: () => openSettingsOn('wifi') }
            : undefined
        }
      : null
  );

  return (
    <LanguageContext value={language}>
      <div
        className="tablet-container"
        data-colour={themeColour}
        data-dynamic={dynamicVars ? '' : undefined}
        style={dynamicVars as CSSProperties | undefined}
      >
        <div
          className="app-tab-panel on-photo"
          role="tabpanel"
          id={tabPanelId('spotify')}
          aria-label={translate('tabs.spotify', language)}
          hidden={screen !== 'spotify'}
        >
          {screen === 'spotify' && <TabBackdrop now={tabBar.now} />}
          <div className="floating-bar">
            <TabBar {...tabBar} />
          </div>
          <div className="room-frame">
            <main className={`listening-room${needsConnection ? ' is-setup' : ''}`}>
              <section className="player-section" aria-label={translate('dashboard.now_playing', language)}>
                {needsConnection ? (
                  <SpotifySetup
                    offline={isOffline}
                    signInError={problem?.recovery === 'sign-in' ? problem.message : null}
                    onDetails={() => setIsDebugOpen(true)}
                  />
                ) : (
                  <AlbumArtPlayer
                    playback={playerPlayback}
                    isPlaying={isPlaying}
                    onPlayPause={followingSonos ? sonos.togglePlay : togglePlay}
                    onNext={followingSonos ? sonos.nextTrack : nextTrack}
                    onPrevious={followingSonos ? sonos.previousTrack : previousTrack}
                    onSeek={followingSonos ? sonos.seek : seek}
                    onVolumeChange={(vol: number) => {
                      if (followingSonos) sonos.setVolume(vol);
                      else if (alongVolume === null) void setVolume(vol / 100);
                      else along.setVolume(vol);
                    }}
                    onToggleShuffle={toggleShuffle}
                    onCycleRepeat={cycleRepeat}
                    controlsEnabled={controlsEnabled}
                    speakerLabel={playingOnLabel(speakers.playingOn, language)}
                    speakersOpen={speakersShown}
                    onOpenSpeakers={chooseSpeaker}
                    problem={
                      playbackProblem?.action && <PlayerProblem problem={playbackProblem} busy={isRefreshingPlayback} />
                    }
                  />
                )}
              </section>

              {!needsConnection && (
                <div className="side-panel" data-showing={panel.view}>
                  {/* All three stay put and cross-fade; the hidden ones are inert, so neither a tap nor a screen reader reaches them. */}
                  <section
                    className="queue-section side-panel-view"
                    aria-label={translate('spotify_tab.upcoming', language)}
                    inert={panel.view !== 'queue'}
                    data-view="queue"
                  >
                    <TrackQueue
                      queue={shownQueue}
                      error={shownQueueError}
                      status={shownQueueStatus}
                      onRetry={() => setQueueRequestVersion(version => version + 1)}
                      onConnect={showSettings}
                      retryAllowed={!waitingForSpotify}
                      onPlay={playQueueTrack}
                      playDisabled={!controlsEnabled || isJumping}
                      // Only a Sonos's queue can be reordered; Spotify's Web API has no way to move a queued song.
                      onMove={followingSonos ? sonos.moveSong : undefined}
                      onSearch={() => setIsMusicOpen(true)}
                    />
                  </section>
                  <div className="side-panel-view" inert={!lyricsShown} data-view="lyrics">
                    <LyricsPanel
                      track={currentTrack}
                      lookup={lyrics}
                      shown={lyricsShown}
                      progressMs={shownPlayback?.progress_ms ?? shownPlayback?.position ?? 0}
                      playing={shownPlayback?.is_playing === true}
                      syncing={lyricsSyncing}
                      onSynced={() => setSyncingTrack(null)}
                    />
                  </div>
                  <section
                    className="side-panel-view"
                    aria-label={translate('panel.speakers', language)}
                    inert={!speakersShown}
                    data-view="speakers"
                  >
                    <SpeakersView selection={speakers} onKiosk={onKiosk} browserDeviceId={browserDeviceId ?? null} />
                  </section>
                </div>
              )}
              {!needsConnection && (
                <PanelNav
                  view={panel.view}
                  onShow={showPanel}
                  lyricsSyncing={lyricsSyncing}
                  speakersButton={speakersButton}
                  onSave={() => void saveSpeakers()}
                  onCancel={speakers.cancel}
                />
              )}
            </main>
          </div>
        </div>
        {hasPodcasts && (
          <section
            className="app-tab-panel on-photo"
            role="tabpanel"
            id={tabPanelId('podcasts')}
            aria-label={translate('tabs.podcasts', language)}
            hidden={screen !== 'podcasts'}
          >
            {screen === 'podcasts' && <TabBackdrop now={tabBar.now} />}
            <div className="floating-bar">
              <TabBar {...tabBar} onSearch={null} />
            </div>
            {screen === 'podcasts' && <PodcastsView podcasts={podcasts} player={podcastPlayer} />}
          </section>
        )}
        <section
          className="app-tab-panel"
          role="tabpanel"
          id={tabPanelId('dashboard')}
          aria-label={translate('tabs.dashboard', language)}
          hidden={screen !== 'dashboard'}
        >
          {/* Mounted while hidden, so its data keeps updating and it is current when the tab comes back. */}
          <DashboardScreen
            tabBar={{ ...tabBar, onSearch: null, nowPlaying: songShown ? nowPlaying : null }}
            groupByRoute={ownedConfig?.arrivals.group_by_route ?? false}
            holidayDaysAhead={ownedConfig?.holidays?.days_ahead}
          />
        </section>
        {hasLights && (
          <section
            className="app-tab-panel on-photo"
            role="tabpanel"
            id={tabPanelId('lights')}
            aria-label={translate('tabs.lights', language)}
            hidden={screen !== 'lights'}
          >
            {screen === 'lights' && <TabBackdrop now={tabBar.now} />}
            <div className="floating-bar">
              <TabBar {...tabBar} onSearch={null} />
            </div>
            {screen === 'lights' && <LightsView {...lights} />}
          </section>
        )}
        <section
          className="app-tab-panel on-photo"
          role="tabpanel"
          id={tabPanelId('settings')}
          aria-label={translate('tabs.settings', language)}
          hidden={screen !== 'settings'}
        >
          {screen === 'settings' && <TabBackdrop now={tabBar.now} />}
          <div className="floating-bar">
            <TabBar {...tabBar} onSearch={null} />
          </div>
          {screen === 'settings' && (
            <SettingsPanel
              initialSection={settingsSection}
              signInError={playerProblem?.recovery === 'sign-in' ? playerProblem.message : null}
              screenSleep={screenSleepMinutes}
              onScreenSleepChange={changeScreenSleep}
              brightness={hasBacklight ? brightness : undefined}
              onBrightnessChange={changeBrightness}
              quietHours={quietHours}
              onQuietHoursChange={changeQuietHours}
              themeColour={themeColour}
              onThemeColourChange={changeThemeColour}
              dynamicColour={dynamicColour}
              onDynamicColourChange={changeDynamicColour}
              kioskUpdate={kioskUpdate}
              saveStatus={deviceConfig.status}
              onShow={deviceConfig.reload}
              deviceConfig={ownedConfig ?? undefined}
              onDeviceConfigSave={deviceConfig.save}
              onOpenDebug={() => setIsDebugOpen(true)}
              onPhoneSetup={setIsPhoneSetup}
            />
          )}
        </section>

        <MusicPicker
          isOpen={isMusicOpen && !needsConnection}
          onClose={() => setIsMusicOpen(false)}
          onPlay={playMusic}
          disabled={!controlsEnabled}
        />

        {pairingFor && isPairingOpen && (
          <PairPhoneSheet
            spotifyId={pairingFor}
            name={peopleOnKiosk().find(person => person.spotifyId === pairingFor)?.name ?? ''}
            imageUrl={peopleOnKiosk().find(person => person.spotifyId === pairingFor)?.imageUrl ?? ''}
            onDone={() => setIsPairingOpen(false)}
          />
        )}

        <DebugConsole
          isOpen={isDebugOpen}
          onClose={() => setIsDebugOpen(false)}
          status={[
            ['Connection', isOffline ? 'Offline' : 'Online'],
            ['Kiosk', onKiosk ? 'Yes' : 'No'],
            ['Signed in', isAuthenticated ? 'Yes' : 'No'],
            ['Playback mode', playbackMode],
            ['Playing on', speakers.playingLabel ?? playbackState?.device?.name ?? 'Nothing'],
            ['Kiosk player', browserDeviceId ? `Ready (${browserDeviceId})` : 'Not connected'],
            ['Kiosk player active', isPlayerActive ? 'Yes' : 'No'],
            ['Active device', playbackState?.device?.name ?? 'None'],
            ['Sonos', followingSonos ? `Following ${sonos.name ?? 'a group'}` : 'Not following'],
            [
              'Now playing',
              currentTrack ? (currentTrack.name ?? currentTrack.title ?? currentTrack.id ?? '?') : 'Nothing'
            ],
            ['Screen', onKiosk ? screenStatus : 'Not managed'],
            ['Current problem', error ?? 'None']
          ]}
        />

        {/* A newer version is asked about once, with the screen awake and no music picker or debug dialog open. The Settings
          tab checks again each time it comes up, so the question can show over it; starting the update hands over to the
          console. */}
        {kioskUpdate.prompting &&
          kioskUpdate.newer &&
          !sleep.asleep &&
          !sleep.dimmed &&
          !isMusicOpen &&
          !isDebugOpen && (
            <UpdatePrompt newer={kioskUpdate.newer} onUpdate={kioskUpdate.start} onLater={kioskUpdate.dismissPrompt} />
          )}
        <UpdateConsole update={kioskUpdate} />

        {(sleep.asleep || sleep.dimmed) && (
          <SleepScreen dimmed={sleep.dimmed} backlit={hasBacklight} onWake={sleep.wake} />
        )}
      </div>
    </LanguageContext>
  );
}
