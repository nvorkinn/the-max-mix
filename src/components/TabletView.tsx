import { useState, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, CSSProperties } from 'react';
import { AudioLines, Clock, Settings, Speaker, MicVocal } from 'lucide-react';
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
import { getChosenSpeakers, routeAudio } from '../audio/airplay';
import { isKiosk } from '../utils/kiosk';
import { debugLog } from '../utils/debugLog';
import { getScreenSleep, setScreenSleep } from '../utils/screenSleep';
import type { ScreenSleepMinutes } from '../utils/screenSleep';
import type { Track } from '../types';
import OfflineBanner from './OfflineBanner';
import AlbumArtPlayer from './AlbumArtPlayer';
import SpotifySetup from './SpotifySetup';
import TrackQueue, { type QueueStatus } from './TrackQueue';
import PlaybackNotice, { type PlaybackNoticeState } from './PlaybackNotice';
import LyricsPanel from './LyricsPanel';
import SettingsModal from './SettingsModal';
import SpeakerSelectorModal from './SpeakerSelectorModal';
import DebugConsole from './DebugConsole';
import SleepScreen from './SleepScreen';

const formatClock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// While this page's player is active the queue is re-read when the SDK says it changed; this is only a safety net.
const QUEUE_POLL_MS = 10_000;
const SDK_QUEUE_POLL_MS = 20_000;
// Holding the footer clock this long opens the debug console; long enough that nobody opens it by accident.
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
    previousTrack,
    seek,
    setVolume,
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
  const [currentTime, setCurrentTime] = useState(formatClock);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSpeakerModalOpen, setIsSpeakerModalOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const debugHold = useHold(() => setIsDebugOpen(true), DEBUG_HOLD_MS);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [theme, setTheme] = useState(() => (localStorage.getItem('maxmix_theme') === 'minimal' ? 'minimal' : 'neon'));
  // Lyrics take the queue's place while shown; remembered so the kiosk comes back the way it was left.
  const [showLyrics, setShowLyrics] = useState(() => localStorage.getItem('maxmix_lyrics') === 'on');
  // AirPlay needs the Pi's audio service, so it is offered on the kiosk only.
  const [onKiosk] = useState(isKiosk);
  const canUseAirPlay = onKiosk;
  const [storedAudioRoute, setStoredAudioRoute] = useState(getAudioRoute);
  const audioRoute: AudioRoute = canUseAirPlay ? storedAudioRoute : 'spotify-connect';

  // AirPlay plays what this tablet's own player plays, so playback moves here and the Pi sends it on to the speakers
  // chosen last time. Spotify Connect hands the sound back to the Pi's own output, ready for a Connect speaker to be
  // picked. The mode changes even if moving playback fails, so the tablet never gets stuck in AirPlay.
  const changeAudioRoute = async (route: AudioRoute) => {
    setStoredAudioRoute(route);
    setAudioRoute(route);
    if (route === 'spotify-connect') {
      routeAudio([]);
      return;
    }
    const speakers = getChosenSpeakers();
    if (browserDeviceId && speakers.length > 0) routeAudio(speakers);
    if (browserDeviceId && playbackState?.device?.id !== browserDeviceId) await transferPlayback(browserDeviceId);
  };

  const toggleLyrics = (show: boolean) => {
    setShowLyrics(show);
    localStorage.setItem('maxmix_lyrics', show ? 'on' : 'off');
  };

  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme);
    localStorage.setItem('maxmix_theme', newTheme);
    showToast(`Appearance updated to ${newTheme === 'minimal' ? 'Paper' : 'Studio'}`);
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
      if (!isCancelled()) timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentTrack?.id, canPollQueue, sdkActive, queueVersion, queueRequestVersion]);

  const artUrl = currentTrack?.album?.images?.[0]?.url;
  useEffect(() => {
    if (artUrl) {
      void extractPalette(artUrl).then(colors => {
        setPalette(colors);
      });
    }
  }, [artUrl]);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 3500);
  };

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

  let footerStatus = 'Spotify browser player';
  if (audioRoute === 'airplay') footerStatus = 'AirPlay from this tablet';
  else if (playbackMode === 'remote') footerStatus = 'Spotify Connect remote';

  return (
    <div
      className="tablet-container"
      data-theme={theme}
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
          <button
            type="button"
            onClick={() => setIsSpeakerModalOpen(true)}
            className="button button-secondary speaker-button"
            title={canUseAirPlay ? 'Choose speakers' : 'Choose a Spotify Connect device'}
            aria-label={canUseAirPlay ? 'Choose speakers' : 'Choose a Spotify Connect device'}
          >
            <Speaker size={15} />
            <span>Speakers</span>
          </button>
          <button
            type="button"
            onClick={() => toggleLyrics(!showLyrics)}
            className="button button-secondary lyrics-button"
            disabled={needsConnection}
            aria-pressed={showLyrics}
            title="Show the lyrics of the current song"
          >
            <MicVocal size={15} />
            <span>Lyrics</span>
          </button>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="icon-button"
            title="Settings"
            aria-label="Open settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {isOffline && <OfflineBanner />}

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
              controlsEnabled={
                isAuthenticated &&
                !isOffline &&
                (isReady || Boolean(browserDeviceId)) &&
                !restricted &&
                (!waitingForSpotify || sdkActive) &&
                !isLoading
              }
              notice={
                notice && (
                  <PlaybackNotice
                    notice={notice}
                    busy={isRefreshingPlayback}
                    onSettings={showSettings}
                    onChooseSpeaker={chooseSpeaker}
                    onRefresh={() => void recoverPlayback(retryPlayback)}
                    onReconnect={reconnectPlayer}
                    onAllowAudio={() => void recoverPlayback(allowBrowserAudio)}
                    onDetails={() => setIsDebugOpen(true)}
                  />
                )
              }
            />
          )}
        </section>

        {!needsConnection &&
          (showLyrics ? (
            <section className="queue-section" aria-label="Lyrics">
              <LyricsPanel
                track={currentTrack}
                progressMs={playbackState?.progress_ms ?? playbackState?.position ?? 0}
                onClose={() => toggleLyrics(false)}
              />
            </section>
          ) : (
            <section className="queue-section" aria-label="Upcoming tracks">
              <TrackQueue
                queue={queue}
                error={queueError}
                status={waitingForSpotify ? 'waiting' : queueStatus}
                onRetry={() => setQueueRequestVersion(version => version + 1)}
                onConnect={showSettings}
                retryAllowed={!waitingForSpotify}
              />
            </section>
          ))}
      </main>

      <footer className="app-footer">
        {playerError && !isOffline ? (
          <button type="button" className="footer-problem-button" onClick={() => setIsDebugOpen(true)}>
            <span className="status-dot status-dot-error" /> {footerStatus} ·{' '}
            <span className="footer-problem">Problem, see details</span>
          </button>
        ) : (
          <span>
            <span className={`status-dot ${statusDotClass}`} /> {footerStatus}
          </span>
        )}
        <span className="footer-clock" {...debugHold}>
          <Clock size={12} /> {currentTime}
        </span>
        <span>POWERED BY SPOTIFY</span>
      </footer>

      {toastMessage && !isSettingsOpen && (
        <div className="app-toast" role="status">
          {toastMessage}
        </div>
      )}

      <SpeakerSelectorModal
        isOpen={isSpeakerModalOpen}
        onClose={() => setIsSpeakerModalOpen(false)}
        onSelectSpeaker={(id: string) => transferPlayback(id)}
        browserDeviceId={browserDeviceId}
        canUseAirPlay={canUseAirPlay}
        audioRoute={audioRoute}
        onAudioRouteChange={changeAudioRoute}
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
          authenticated: isAuthenticated && problem?.recovery !== 'sign-in',
          playbackMode
        }}
        signInError={signInError || (playerProblem?.recovery === 'sign-in' ? playerProblem.message : null)}
        currentTheme={theme}
        onThemeChange={handleThemeChange}
        statusMessage={toastMessage}
        screenSleep={screenSleepMinutes}
        onScreenSleepChange={changeScreenSleep}
      />

      {sleep.asleep && <SleepScreen onWake={sleep.wake} />}
    </div>
  );
}
