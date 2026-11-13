import { useState, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, CSSProperties } from 'react';
import { AudioLines, Clock, Search, Settings } from 'lucide-react';
import { useSpotifyPlayer } from '../hooks/useSpotifyPlayer';
import { useSonosPlayer } from '../hooks/useSonosPlayer';
import { useSpotifyCooldown } from '../hooks/useSpotifyCooldown';
import { useKioskUpdate } from '../hooks/useKioskUpdate';
import { useSpotifyPolling } from '../hooks/useSpotifyPolling';
import { useScreenSleep } from '../hooks/useScreenSleep';
import { usePanelView } from '../hooks/usePanelView';
import { extractArtColours, type ArtColours } from '../utils/colorExtractor';
import { useIsOffline } from '../hooks/useOnlineStatus';
import { errorMessage } from '../utils/errorMessage';
import { getQueue } from '../spotify/api';
import { getKioskSonosLeader, playOnSonosRoom } from '../sonos/kiosk';
import { rememberSpeaker } from '../spotify/knownDevices';
import { getSpotifyRetryDelay, recordSpotifyRetryAfter, SpotifyApiError } from '../spotify/http';
import { useSpeakerSelection } from '../speakers/useSpeakerSelection';
import { isKiosk } from '../utils/kiosk';
import { debugLog } from '../utils/debugLog';
import { getScreenSleep, setScreenSleep } from '../utils/screenSleep';
import type { ScreenSleepMinutes } from '../utils/screenSleep';
import { loadThemeColour, saveThemeColour } from '../utils/themeColour';
import { useTheme } from '../hooks/useTheme';
import type { ThemeColour } from '../utils/themeColour';
import type { MusicChoice, Track } from '../types';
import OfflineBanner from './OfflineBanner';
import AlbumArtPlayer from './AlbumArtPlayer';
import SpotifySetup from './SpotifySetup';
import TrackQueue, { type QueueStatus } from './TrackQueue';
import PlaybackBanner, { type PlaybackNoticeState, type BannerNotice } from './PlaybackNotice';
import LyricsPanel from './LyricsPanel';
import PanelNav from './PanelNav';
import SettingsModal from './SettingsModal';
import type { SettingsSection } from './SettingsModal';
import UpdateConsole from './UpdateConsole';
import UpdatePrompt from './UpdatePrompt';
import SpeakersView from './SpeakersView';
import MusicPicker from './MusicPicker';
import DebugConsole from './DebugConsole';
import SleepScreen from './SleepScreen';
import SleepIcon from './SleepIcon';

const formatClock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// While this page's player is active the queue is re-read when the SDK says it changed; this is only a safety net.
const QUEUE_POLL_MS = 10_000;
const SDK_QUEUE_POLL_MS = 20_000;
// Holding the header clock this long opens the debug console; long enough that nobody opens it by accident.
const DEBUG_HOLD_MS = 2000;

/** Pointer handlers that call `onHold` once the element has been held down for `ms`. */
function useHold(onHold: () => void, ms: number) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const cancel = () => clearTimeout(timerRef.current);
  return {
    onPointerDown: (event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      cancel();
      timerRef.current = setTimeout(onHold, ms);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event: ReactMouseEvent) => event.preventDefault()
  };
}

/** Writes `message` to the debug log each time it changes to a new, non-empty value. */
function useLogChanges(message: string | null | undefined, source: string) {
  useEffect(() => {
    if (message) debugLog('error', source, message);
  }, [message, source]);
}

// signInError: why finishing the Spotify sign-in failed
export default function TabletView({ signInError = null }: Readonly<{ signInError?: string | null | undefined }>) {
  const {
    isReady,
    playbackState,
    isAuthenticated,
    isLoading,
    isConnecting,
    playbackMode,
    browserDeviceId,
    sdkActive,
    queueVersion,
    error: playerError,
    problem: playerProblem,
    retryPlayback,
    reconnectPlayer,
    allowBrowserAudio,
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
  const error = playerError || signInError;
  const isOffline = useIsOffline(playerError);
  // While a Sonos plays, Spotify's queue is not what plays next; the Sonos says its next song itself.
  const canPollQueue = isAuthenticated && !followingSonos;
  const spotifyRetryAt = useSpotifyCooldown();
  const waitingForSpotify = spotifyRetryAt > 0;
  const { enabled: pollEnabled, quotaExceeded } = useSpotifyPolling();

  const [queue, setQueue] = useState<Track[]>([]);
  const [queueStatus, setQueueStatus] = useState<QueueStatus>(canPollQueue ? 'loading' : 'idle');
  const [queueRequestVersion, setQueueRequestVersion] = useState(0);
  const [isRefreshingPlayback, setIsRefreshingPlayback] = useState(false);
  // True while a tapped queue song is being skipped to, so a second tap cannot start another jump.
  const [isJumping, setIsJumping] = useState(false);
  const [currentTime, setCurrentTime] = useState(formatClock);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // The header's button opens the overview; the sign-in prompts open the Spotify page.
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('overview');
  const [isMusicOpen, setIsMusicOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const debugHold = useHold(() => setIsDebugOpen(true), DEBUG_HOLD_MS);
  const [queueError, setQueueError] = useState<string | null>(null);
  // AirPlay, Bluetooth and Sonos need the Pi's audio service, so they are offered on the kiosk only.
  const [onKiosk] = useState(isKiosk);

  // Spotify will not move its playback to a Sonos, so on the kiosk the Pi starts the song on the speaker itself
  // (sonos-ts), with Spotify's queue after it and from where the song was. The tablet is paused first, while it is still
  // the player (afterwards Spotify has moved on and a pause fails), and its player lets go. From then on the tablet shows
  // and controls the Sonos group (useSonosPlayer), which SonosKioskList marks as the kiosk's. Picking another Sonos while
  // following one plays the Sonos's song there, from the same point. The Speakers view's Save calls it (useSpeakerSelection).
  const playOnSonos = async (room: string) => {
    const shown = sonos.active ? sonos.playback : playbackState;
    const uri = shown?.item?.uri;
    if (!uri) throw new Error('Play a song first, then pick the Sonos speaker.');
    const positionMs = shown.progress_ms ?? 0;
    if (sonos.active) {
      // The Pi carries over the queue of the Sonos group the music moves from.
      await playOnSonosRoom(room, uri, { positionMs, queueFrom: getKioskSonosLeader() });
      return;
    }
    // The queue as Spotify has it now; the one on screen may be a few seconds old, or not read at all.
    const upcoming = await getQueue()
      .then(reply => reply.queue)
      .catch(() => queue);
    if (playbackState?.is_playing && !(await togglePlay())) debugLog('warn', 'sonos', 'Spotify did not pause');
    const next = upcoming.map(track => track.uri).filter((song): song is string => Boolean(song));
    await playOnSonosRoom(room, uri, { next, positionMs });
    await handOff();
  };

  // Music picked while a Sonos plays goes to the Sonos (a song, album or playlist; Liked Songs cannot).
  const playMusic = (choice: MusicChoice) => (sonos.active ? sonos.play(choice.uri) : playMusicOnSpotify(choice));

  // Colours read from the album art tint the page faintly behind the queue; none means no tint.
  const [artColours, setArtColours] = useState<ArtColours | null>(null);

  // Spotify's device list can leave out a speaker that plays (Sonos does), so the drawer remembers each one seen playing.
  const playingDevice = playbackState?.device;
  useEffect(() => {
    rememberSpeaker(playingDevice);
    if (playingDevice) debugLog('info', 'playing device', JSON.stringify(playingDevice));
  }, [playingDevice]);
  const isPlaying = Boolean(shownPlayback?.is_playing);
  const currentTrack = shownPlayback?.item;

  // The kiosk's screen stays on while music plays and sleeps after the chosen idle minutes otherwise.
  const [screenSleepMinutes, setScreenSleepMinutes] = useState(getScreenSleep);
  const changeScreenSleep = (minutes: ScreenSleepMinutes) => {
    setScreenSleepMinutes(minutes);
    setScreenSleep(minutes);
  };
  const [themeColour, setThemeColour] = useState(loadThemeColour);
  const changeThemeColour = (colour: ThemeColour) => {
    setThemeColour(colour);
    saveThemeColour(colour);
  };
  const theme = useTheme();
  const kioskUpdate = useKioskUpdate(onKiosk);
  const sleep = useScreenSleep({
    enabled: onKiosk,
    keepAwake: isPlaying,
    idleMs: screenSleepMinutes === 0 ? null : screenSleepMinutes * 60_000
  });
  // Waking the screen asks GitHub again whether a newer version is out: someone is back, and hours may have passed.
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
  const screenStatus = `${sleep.asleep ? 'Asleep' : 'Awake'}, wake lock ${sleep.wakeLock}`;

  // Problems go to the debug console.
  useLogChanges(playerError, 'player');
  useLogChanges(signInError, 'sign-in');
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
    const interval = setInterval(() => setCurrentTime(formatClock()), 1000);
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
    if (quotaExceeded || !canPollQueue || sleep.asleep) return;
    let cancelled = false;
    // Read through a function: TypeScript narrows the flag to `false` and cannot see the cleanup flip it mid-await.
    const isCancelled = () => cancelled;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const base = sdkActive ? SDK_QUEUE_POLL_MS : QUEUE_POLL_MS;
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
    sleep.asleep,
    quotaExceeded,
    pollEnabled,
    sdkActive,
    isPlaying,
    queueVersion,
    queueRequestVersion
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

  const showSettings = () => {
    setSettingsSection('spotify');
    setIsSettingsOpen(true);
  };
  const recoverPlayback = async (action: () => Promise<boolean>) => {
    if (isRefreshingPlayback) return;
    setIsRefreshingPlayback(true);
    try {
      await action();
    } finally {
      setIsRefreshingPlayback(false);
    }
  };
  const problem = signInError ? { message: signInError, recovery: 'sign-in' as const } : playerProblem;
  const needsConnection = !isLoading && (!isAuthenticated || problem?.recovery === 'sign-in');
  const restricted = Boolean(playbackState?.device?.is_restricted);
  let notice: PlaybackNoticeState | null = null;
  if (isOffline) notice = { kind: 'offline' };
  else if (signInError && problem) notice = { kind: 'problem', problem };
  else if (!isAuthenticated) notice = { kind: 'signed-out' };
  else if (followingSonos && problem?.recovery !== 'sign-in') {
    // Spotify has let go of the music, so its own problems (no player, a restricted device) are not this screen's.
    if (sonos.error) notice = { kind: 'problem', problem: { message: sonos.error, recovery: 'refresh' } };
  } else if (restricted) notice = { kind: 'restricted' };
  else if (problem?.recovery === 'sign-in') notice = { kind: 'problem', problem };
  else if (quotaExceeded) {
    notice = { kind: 'problem', problem: { message: 'Spotify quota exceeded.', recovery: 'quota' } };
  } else if (waitingForSpotify) {
    notice = {
      kind: 'problem',
      problem: { message: playerError || 'Spotify asked this app to wait before retrying.', recovery: 'wait' }
    };
  } else if (problem) {
    const recovery = problem.recovery === 'wait' ? 'refresh' : problem.recovery;
    notice = { kind: 'problem', problem: { ...problem, recovery } };
  } else if (isLoading || (!isReady && isConnecting)) notice = { kind: 'connecting' };
  else if (!isReady && !browserDeviceId) notice = { kind: 'no-device' };
  else if (!currentTrack) notice = { kind: 'idle' };
  // Only trouble needing the user's attention goes in the banner; idle and connecting states are the player's own.
  let banner: BannerNotice | null = null;
  if (!needsConnection && notice?.kind === 'problem') banner = notice;
  else if (!needsConnection && notice?.kind === 'restricted') banner = { kind: 'restricted' };
  const spotifyControlsEnabled =
    isAuthenticated &&
    !isOffline &&
    (isReady || Boolean(browserDeviceId)) &&
    !restricted &&
    (!waitingForSpotify || sdkActive) &&
    !isLoading;
  const controlsEnabled = followingSonos
    ? isAuthenticated && !isOffline && Boolean(sonos.playback)
    : spotifyControlsEnabled;
  let shownQueueStatus: QueueStatus = waitingForSpotify ? 'waiting' : queueStatus;
  if (followingSonos) shownQueueStatus = 'ready';
  const shownQueue = followingSonos ? sonos.next : queue;
  const shownQueueError = followingSonos ? null : queueError;
  // The lyrics come forward only once the queue is known to be empty: a queue that failed or is waiting for Spotify keeps
  // the queue in view, with its retry. Each poll reads as loading for a moment, so the panel only changes between polls.
  const queueSettled = shownQueueStatus !== 'loading' || shownQueue.length > 0;
  const queueEmpty = shownQueue.length === 0 && shownQueueStatus === 'ready' && !shownQueueError;
  const panel = usePanelView(queueEmpty, queueSettled);
  const lyricsShown = panel.view === 'lyrics';
  const speakersShown = panel.view === 'speakers';
  const chooseSpeaker = () => panel.show('speakers');
  const speakers = useSpeakerSelection({
    onKiosk,
    open: speakersShown && !needsConnection,
    browserDeviceId: browserDeviceId ?? null,
    playingDeviceId: playbackState?.device?.id ?? null,
    sonosName: sonos.name ?? null,
    transfer: transferPlayback,
    playOnSonos,
    leaveSonos: sonos.leave
  });
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

  return (
    <div
      className="tablet-container"
      data-colour={themeColour}
      data-theme={theme.skin}
      style={
        artColours
          ? ({ '--art-tint-top': artColours.top, '--art-tint-bottom': artColours.bottom } as CSSProperties)
          : undefined
      }
    >
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <AudioLines size={22} strokeWidth={2.5} />
          </div>
          <div className="brand-copy">
            <h1>
              THE MAX MIX<span className="brand-dot">.</span>
            </h1>
          </div>
        </div>
        <div className="header-actions">
          {!needsConnection && (
            <button
              type="button"
              onClick={() => setIsMusicOpen(true)}
              className="icon-button"
              title="Choose music"
              aria-label="Choose music"
            >
              <Search size={28} />
            </button>
          )}
          {onKiosk && (
            <button
              type="button"
              onClick={sleep.sleepNow}
              className="icon-button"
              title="Sleep"
              aria-label="Put the screen to sleep"
            >
              <SleepIcon size={28} />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setSettingsSection('overview');
              setIsSettingsOpen(true);
            }}
            className="icon-button"
            title="Settings"
            aria-label="Open settings"
          >
            <Settings size={28} />
          </button>
          <span className="header-clock" {...debugHold}>
            <Clock size={14} /> {currentTime}
          </span>
        </div>
      </header>

      {isOffline && <OfflineBanner />}
      {banner && (
        <PlaybackBanner
          notice={banner}
          busy={isRefreshingPlayback}
          onSettings={showSettings}
          onChooseSpeaker={chooseSpeaker}
          onRefresh={followingSonos ? sonos.refresh : () => void recoverPlayback(retryPlayback)}
          onReconnect={reconnectPlayer}
          onAllowAudio={() => void recoverPlayback(allowBrowserAudio)}
          onDetails={() => setIsDebugOpen(true)}
        />
      )}

      <div className="room-frame">
        <main className={`listening-room${needsConnection ? ' is-setup' : ''}`}>
          <section className="player-section" aria-label="Now playing">
            {needsConnection ? (
              <SpotifySetup
                offline={isOffline}
                signInError={signInError || (problem?.recovery === 'sign-in' ? problem.message : null)}
                onSettings={showSettings}
                onDetails={() => setIsDebugOpen(true)}
              />
            ) : (
              <AlbumArtPlayer
                playback={shownPlayback}
                isPlaying={isPlaying}
                onPlayPause={followingSonos ? sonos.togglePlay : togglePlay}
                onNext={followingSonos ? sonos.nextTrack : nextTrack}
                onPrevious={followingSonos ? sonos.previousTrack : previousTrack}
                onSeek={followingSonos ? sonos.seek : seek}
                onVolumeChange={(vol: number) => (followingSonos ? sonos.setVolume(vol) : setVolume(vol / 100))}
                onToggleShuffle={toggleShuffle}
                onCycleRepeat={cycleRepeat}
                controlsEnabled={controlsEnabled}
                speakerLabel={speakers.playingLabel}
                speakersOpen={speakersShown}
                onOpenSpeakers={chooseSpeaker}
              />
            )}
          </section>

          {!needsConnection && (
            <div className="side-panel" data-showing={panel.view}>
              {/* All three stay put and cross-fade; the hidden ones are inert, so neither a tap nor a screen reader reaches them. */}
              <section
                className="queue-section side-panel-view"
                aria-label="Upcoming tracks"
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
                />
              </section>
              <div className="side-panel-view" inert={!lyricsShown} data-view="lyrics">
                <LyricsPanel
                  track={currentTrack}
                  shown={lyricsShown}
                  progressMs={shownPlayback?.progress_ms ?? shownPlayback?.position ?? 0}
                />
              </div>
              <section className="side-panel-view" aria-label="Speakers" inert={!speakersShown} data-view="speakers">
                <SpeakersView selection={speakers} onKiosk={onKiosk} browserDeviceId={browserDeviceId ?? null} />
              </section>
            </div>
          )}
          {!needsConnection && (
            <PanelNav
              view={panel.view}
              onShow={panel.show}
              speakersButton={speakersButton}
              onSave={() => void speakers.save()}
              onCancel={speakers.cancel}
            />
          )}
        </main>
      </div>

      <MusicPicker
        isOpen={isMusicOpen && !needsConnection}
        onClose={() => setIsMusicOpen(false)}
        onPlay={playMusic}
        disabled={!controlsEnabled}
      />

      <DebugConsole
        isOpen={isDebugOpen}
        onClose={() => setIsDebugOpen(false)}
        status={[
          ['Connection', isOffline ? 'Offline' : 'Online'],
          ['Kiosk', onKiosk ? 'Yes' : 'No'],
          ['Signed in', isAuthenticated ? 'Yes' : 'No'],
          ['Playback mode', playbackMode],
          ['Playing on', speakers.playingLabel ?? playbackState?.device?.name ?? 'Nothing'],
          ['Browser player', browserDeviceId ? `Ready (${browserDeviceId})` : 'Not connected'],
          ['SDK driving', sdkActive ? 'Yes' : 'No'],
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

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialSection={settingsSection}
        authInfo={{
          authenticated: isAuthenticated && problem?.recovery !== 'sign-in'
        }}
        signInError={signInError || (playerProblem?.recovery === 'sign-in' ? playerProblem.message : null)}
        screenSleep={screenSleepMinutes}
        onScreenSleepChange={changeScreenSleep}
        themeColour={themeColour}
        onThemeColourChange={changeThemeColour}
        theme={theme.theme}
        autoTheme={theme.autoOffered}
        onThemeChange={theme.change}
        skin={theme.skin}
        kioskUpdate={kioskUpdate}
      />

      {/* A newer version is asked about once, with the screen awake and no music picker or debug dialog open. It also shows over
          the settings (which check again each time they open), and starting the update from it closes them: the console takes
          over. Dialogs stack in the order they were opened (the browser's top layer), and this one can only open after the
          settings, which the page behind a modal dialog cannot reopen: e2e/update-popup.spec.ts checks it is on top. */}
      {kioskUpdate.prompting && kioskUpdate.newer && !sleep.asleep && !isMusicOpen && !isDebugOpen && (
        <UpdatePrompt
          newer={kioskUpdate.newer}
          onUpdate={() => {
            kioskUpdate.start();
            setIsSettingsOpen(false);
          }}
          onLater={kioskUpdate.dismissPrompt}
        />
      )}
      <UpdateConsole update={kioskUpdate} />

      {sleep.asleep && <SleepScreen onWake={sleep.wake} />}
    </div>
  );
}
