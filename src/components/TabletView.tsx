import { useState, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, CSSProperties } from 'react';
import { AudioLines, Clock, Settings } from 'lucide-react';
import { useSpotifyPlayer } from '../hooks/useSpotifyPlayer';
import { useSpotifyCooldown } from '../hooks/useSpotifyCooldown';
import { useScreenSleep } from '../hooks/useScreenSleep';
import { extractPalette } from '../utils/colorExtractor';
import { useIsOffline } from '../hooks/useOnlineStatus';
import { errorMessage } from '../utils/errorMessage';
import { getQueue } from '../spotify/api';
import { getSpotifyRetryDelay, recordSpotifyRetryAfter, SpotifyApiError } from '../spotify/http';
import { getAudioRoute, setAudioRoute } from '../spotify/settings';
import type { AudioRoute } from '../spotify/settings';
import { getChosenSpeakers, routeAudio, setChosenSpeakers } from '../audio/airplay';
import { isKiosk } from '../utils/kiosk';
import { debugLog } from '../utils/debugLog';
import { getScreenSleep, setScreenSleep } from '../utils/screenSleep';
import type { ScreenSleepMinutes } from '../utils/screenSleep';
import { loadThemeColour, saveThemeColour } from '../utils/themeColour';
import type { ThemeColour } from '../utils/themeColour';
import type { Track } from '../types';
import OfflineBanner from './OfflineBanner';
import AlbumArtPlayer from './AlbumArtPlayer';
import SpotifySetup from './SpotifySetup';
import TrackQueue, { type QueueStatus } from './TrackQueue';
import PlaybackBanner, { type PlaybackNoticeState, type BannerNotice } from './PlaybackNotice';
import LyricsPanel from './LyricsPanel';
import SettingsModal from './SettingsModal';
import SpeakerDrawer from './SpeakerDrawer';
import DebugConsole from './DebugConsole';
import SleepScreen from './SleepScreen';

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
    liked,
    toggleLike,
    transferPlayback
  } = useSpotifyPlayer();
  const error = playerError || signInError;
  const isOffline = useIsOffline(playerError);
  const canPollQueue = isAuthenticated;
  const spotifyRetryAt = useSpotifyCooldown();
  const waitingForSpotify = spotifyRetryAt > 0;

  const [queue, setQueue] = useState<Track[]>([]);
  const [queueStatus, setQueueStatus] = useState<QueueStatus>(canPollQueue ? 'loading' : 'idle');
  const [queueRequestVersion, setQueueRequestVersion] = useState(0);
  const [isRefreshingPlayback, setIsRefreshingPlayback] = useState(false);
  // True while a tapped queue song is being skipped to, so a second tap cannot start another jump.
  const [isJumping, setIsJumping] = useState(false);
  const [currentTime, setCurrentTime] = useState(formatClock);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSpeakerModalOpen, setIsSpeakerModalOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const debugHold = useHold(() => setIsDebugOpen(true), DEBUG_HOLD_MS);
  const [queueError, setQueueError] = useState<string | null>(null);
  // Lyrics take the artwork's place while shown; remembered so the kiosk comes back the way it was left.
  const [showLyrics, setShowLyrics] = useState(() => localStorage.getItem('maxmix_lyrics') === 'on');
  // AirPlay needs the Pi's audio service, so it is offered on the kiosk only.
  const [onKiosk] = useState(isKiosk);
  const canUseAirPlay = onKiosk;
  const [storedAudioRoute, setStoredAudioRoute] = useState(getAudioRoute);
  const audioRoute: AudioRoute = canUseAirPlay ? storedAudioRoute : 'spotify-connect';

  // AirPlay plays what this tablet's own player plays, so its speakers can only be picked while this tablet is the one
  // playing; the Pi then sends the sound on to the chosen speakers. Choosing a Spotify Connect speaker (or this tablet
  // again) hands the sound back to the Pi's own output and forgets the AirPlay speakers.
  const changeAudioRoute = (route: AudioRoute) => {
    setStoredAudioRoute(route);
    setAudioRoute(route);
  };

  const chooseAirPlaySpeakers = (speakers: string[]) => {
    if (speakers.length === 0) {
      changeAudioRoute('spotify-connect');
      return;
    }
    changeAudioRoute('airplay');
    if (browserDeviceId) routeAudio(speakers);
  };

  const chooseSpotifyDevice = async (deviceId: string) => {
    if (audioRoute === 'airplay') {
      changeAudioRoute('spotify-connect');
      setChosenSpeakers([]);
      routeAudio([]);
    }
    await transferPlayback(deviceId);
  };

  const toggleLyrics = (show: boolean) => {
    setShowLyrics(show);
    localStorage.setItem('maxmix_lyrics', show ? 'on' : 'off');
  };

  const [palette, setPalette] = useState({
    primary: 'rgba(29, 185, 84, 0.45)',
    secondary: 'rgba(6, 182, 212, 0.35)',
    dark: 'rgba(10, 12, 18, 0.95)'
  });

  const isPlaying = Boolean(playbackState?.is_playing);
  const currentTrack = playbackState?.item;

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
  const sleep = useScreenSleep({
    enabled: onKiosk,
    keepAwake: isPlaying,
    idleMs: screenSleepMinutes === 0 ? null : screenSleepMinutes * 60_000
  });
  const screenStatus = `${sleep.asleep ? 'Asleep' : 'Awake'}, wake lock ${sleep.wakeLock}`;

  // Problems go to the debug console.
  useLogChanges(playerError, 'player');
  useLogChanges(signInError, 'sign-in');
  useLogChanges(queueError, 'queue');

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
    if (!canPollQueue) return;
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
      if (isPlaying && !isCancelled()) timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentTrack?.id, canPollQueue, sdkActive, isPlaying, queueVersion, queueRequestVersion]);

  const artUrl = currentTrack?.album?.images?.[0]?.url;
  useEffect(() => {
    if (artUrl) {
      void extractPalette(artUrl).then(colors => {
        setPalette(colors);
      });
    }
  }, [artUrl]);

  const showSettings = () => setIsSettingsOpen(true);
  const chooseSpeaker = () => setIsSpeakerModalOpen(true);
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
  else if (restricted) notice = { kind: 'restricted' };
  else if (problem?.recovery === 'sign-in') notice = { kind: 'problem', problem };
  else if (waitingForSpotify) {
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
  const controlsEnabled =
    isAuthenticated &&
    !isOffline &&
    (isReady || Boolean(browserDeviceId)) &&
    !restricted &&
    (!waitingForSpotify || sdkActive) &&
    !isLoading;
  // What the device indicator in the control bar says is playing.
  let speakerLabel: string | undefined;
  if (audioRoute === 'airplay') {
    const count = getChosenSpeakers().length;
    speakerLabel = 'AirPlay';
    if (count === 1) speakerLabel = 'AirPlay, 1 speaker';
    else if (count > 1) speakerLabel = `AirPlay, ${count} speakers`;
  } else if (browserDeviceId && playbackState?.device?.id === browserDeviceId) speakerLabel = 'This tablet';
  /** Plays the queue song at this position by skipping past the ones before it. */
  const playQueueTrack = async (index: number) => {
    setIsJumping(true);
    try {
      await skipAhead(index + 1);
    } finally {
      setIsJumping(false);
    }
  };
  let sessionStatus: string;
  if (notice) {
    sessionStatus = {
      offline: 'Offline',
      'signed-out': 'Spotify not connected',
      connecting: 'Connecting to Spotify...',
      restricted: 'Device controls unavailable',
      problem: 'Playback problem',
      'no-device': 'Choose a Spotify speaker',
      idle: 'No track playing'
    }[notice.kind];
  } else sessionStatus = `${isPlaying ? 'Playing' : 'Paused'} on ${playbackState?.device?.name || 'Spotify'}`;
  if (notice?.kind === 'problem' && notice.problem.recovery === 'wait') sessionStatus = 'Waiting for Spotify';
  let statusDotClass = '';
  if (notice?.kind === 'problem' && notice.problem.recovery !== 'wait') statusDotClass = 'status-dot-error';
  else if (notice || !isPlaying) statusDotClass = 'status-dot-idle';

  return (
    <div
      className="tablet-container"
      data-colour={themeColour}
      style={
        {
          '--ambient-primary': palette.primary,
          '--ambient-secondary': palette.secondary
        } as CSSProperties
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
        <div className="session-status" role="status">
          <span className={`status-dot ${statusDotClass}`} />
          {sessionStatus}
        </div>
        <div className="header-actions">
          <span className="header-clock" {...debugHold}>
            <Clock size={14} /> {currentTime}
          </span>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="icon-button"
            title="Settings"
            aria-label="Open settings"
          >
            <Settings size={22} />
          </button>
        </div>
      </header>

      {isOffline && <OfflineBanner />}
      {banner && (
        <PlaybackBanner
          notice={banner}
          busy={isRefreshingPlayback}
          onSettings={showSettings}
          onChooseSpeaker={chooseSpeaker}
          onRefresh={() => void recoverPlayback(retryPlayback)}
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
                playback={playbackState}
                isPlaying={isPlaying}
                onPlayPause={togglePlay}
                onNext={nextTrack}
                onPrevious={previousTrack}
                onSeek={seek}
                onVolumeChange={(vol: number) => setVolume(vol / 100)}
                onToggleShuffle={toggleShuffle}
                onCycleRepeat={cycleRepeat}
                liked={liked}
                onToggleLike={toggleLike}
                controlsEnabled={controlsEnabled}
                speakerLabel={speakerLabel}
                speakersOpen={isSpeakerModalOpen}
                onOpenSpeakers={() => setIsSpeakerModalOpen(true)}
                lyricsOpen={showLyrics}
                onToggleLyrics={() => toggleLyrics(!showLyrics)}
                lyrics={
                  <LyricsPanel
                    track={currentTrack}
                    progressMs={playbackState?.progress_ms ?? playbackState?.position ?? 0}
                  />
                }
              />
            )}
          </section>

          {!needsConnection && (
            <section className="queue-section" aria-label="Upcoming tracks">
              <TrackQueue
                queue={queue}
                error={queueError}
                status={waitingForSpotify ? 'waiting' : queueStatus}
                onRetry={() => setQueueRequestVersion(version => version + 1)}
                onConnect={showSettings}
                retryAllowed={!waitingForSpotify}
                onPlay={playQueueTrack}
                playDisabled={!controlsEnabled || isJumping}
              />
            </section>
          )}
        </main>
      </div>

      <SpeakerDrawer
        isOpen={isSpeakerModalOpen}
        onClose={() => setIsSpeakerModalOpen(false)}
        onSelectSpeaker={chooseSpotifyDevice}
        browserDeviceId={browserDeviceId}
        activeDeviceId={playbackState?.device?.id ?? null}
        canUseAirPlay={canUseAirPlay}
        audioRoute={audioRoute}
        onAirPlayChange={chooseAirPlaySpeakers}
      />

      <DebugConsole
        isOpen={isDebugOpen}
        onClose={() => setIsDebugOpen(false)}
        status={[
          ['Connection', isOffline ? 'Offline' : 'Online'],
          ['Kiosk', onKiosk ? 'Yes' : 'No'],
          ['Signed in', isAuthenticated ? 'Yes' : 'No'],
          ['Playback mode', playbackMode],
          ['Audio route', audioRoute],
          ['Browser player', browserDeviceId ? `Ready (${browserDeviceId})` : 'Not connected'],
          ['SDK driving', sdkActive ? 'Yes' : 'No'],
          ['Active device', playbackState?.device?.name ?? 'None'],
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
        authInfo={{
          authenticated: isAuthenticated && problem?.recovery !== 'sign-in'
        }}
        signInError={signInError || (playerProblem?.recovery === 'sign-in' ? playerProblem.message : null)}
        screenSleep={screenSleepMinutes}
        onScreenSleepChange={changeScreenSleep}
        themeColour={themeColour}
        onThemeColourChange={changeThemeColour}
      />

      {sleep.asleep && <SleepScreen onWake={sleep.wake} />}
    </div>
  );
}
