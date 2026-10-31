import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { AudioLines, Clock, Settings, Speaker, ArrowUpRight, MicVocal } from 'lucide-react';
import { useSpotifyPlayer } from '../hooks/useSpotifyPlayer';
import { extractPalette } from '../utils/colorExtractor';
import { useIsOffline } from '../hooks/useOnlineStatus';
import { errorMessage } from '../utils/errorMessage';
import { getQueue, reorderDemoQueue, playDemoTrackNow } from '../spotify/api';
import { SpotifyApiError } from '../spotify/http';
import { getAudioRoute, setAudioRoute } from '../spotify/settings';
import type { AudioRoute } from '../spotify/settings';
import { setAirPlaySpeakers } from '../audio/airplay';
import { isKiosk } from '../utils/kiosk';
import type { Track } from '../types';
import OfflineBanner from './OfflineBanner';
import AlbumArtPlayer from './AlbumArtPlayer';
import SpotifyJamQueue from './SpotifyJamQueue';
import LyricsPanel from './LyricsPanel';
import SettingsModal from './SettingsModal';
import SpeakerSelectorModal from './SpeakerSelectorModal';
import JamSettingsModal from './JamSettingsModal';

const formatClock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// While this page's player is active the queue is re-read when the SDK says it changed; this is only a safety net.
const QUEUE_POLL_MS = 10_000;
const SDK_QUEUE_POLL_MS = 20_000;

// signInError: why finishing the Spotify sign-in failed
export default function TabletView({ signInError = null }: Readonly<{ signInError?: string | null | undefined }>) {
  const {
    isReady,
    playbackState,
    isAuthenticated,
    isDemoMode,
    isLoading,
    playbackMode,
    browserDeviceId,
    sdkActive,
    queueVersion,
    error: playerError,
    refreshPlayback,
    togglePlay,
    nextTrack,
    previousTrack,
    seek,
    setVolume,
    transferPlayback
  } = useSpotifyPlayer();
  const error = playerError || signInError;
  const isOffline = useIsOffline(playerError);

  const [queue, setQueue] = useState<Track[]>([]);
  const [currentTime, setCurrentTime] = useState(formatClock);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSpeakerModalOpen, setIsSpeakerModalOpen] = useState(false);
  const [isJamSettingsOpen, setIsJamSettingsOpen] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [theme, setTheme] = useState(() => (localStorage.getItem('maxmix_theme') === 'minimal' ? 'minimal' : 'neon'));
  // Lyrics take the queue's place while shown; remembered so the kiosk comes back the way it was left.
  const [showLyrics, setShowLyrics] = useState(() => localStorage.getItem('maxmix_lyrics') === 'on');
  // AirPlay needs the Pi's audio service, so it is offered on the kiosk only (and not with simulated playback).
  const [onKiosk] = useState(isKiosk);
  const canUseAirPlay = onKiosk && !isDemoMode;
  const [storedAudioRoute, setStoredAudioRoute] = useState(getAudioRoute);
  const audioRoute: AudioRoute = canUseAirPlay ? storedAudioRoute : 'spotify-connect';

  // AirPlay plays what this tablet's own player plays, so playback moves here. Spotify Connect hands the sound back to
  // the Pi's own output, ready for a Connect speaker to be picked. The mode changes even if that step fails, so a stopped
  // audio service never keeps the tablet stuck in AirPlay.
  const changeAudioRoute = async (route: AudioRoute) => {
    setStoredAudioRoute(route);
    setAudioRoute(route);
    if (route === 'spotify-connect') await setAirPlaySpeakers([]);
    else if (browserDeviceId && playbackState?.device?.id !== browserDeviceId) await transferPlayback(browserDeviceId);
  };

  const toggleLyrics = (show: boolean) => {
    setShowLyrics(show);
    localStorage.setItem('maxmix_lyrics', show ? 'on' : 'off');
  };

  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme);
    localStorage.setItem('maxmix_theme', newTheme);
    showToast(`Skin updated to ${newTheme === 'minimal' ? 'Paper' : 'Studio'}`);
  };

  const [palette, setPalette] = useState({
    primary: 'rgba(29, 185, 84, 0.45)',
    secondary: 'rgba(6, 182, 212, 0.35)',
    dark: 'rgba(10, 12, 18, 0.95)'
  });

  const isPlaying = Boolean(playbackState?.is_playing);
  const currentTrack = playbackState?.item;

  // Clock
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(formatClock()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Drop the queue and its error as soon as polling stops (adjusted during render, not in an effect).
  const canPollQueue = isDemoMode || isAuthenticated;
  const [couldPollQueue, setCouldPollQueue] = useState(canPollQueue);
  if (couldPollQueue !== canPollQueue) {
    setCouldPollQueue(canPollQueue);
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
      let delay = base;
      try {
        const data = await getQueue();
        if (isCancelled()) return;
        setQueue(data.queue);
        setQueueError(null);
        failures = 0;
      } catch (caught) {
        if (isCancelled()) return;
        setQueueError(errorMessage(caught));
        const retryAfter = caught instanceof SpotifyApiError ? caught.retryAfter : 0;
        delay = Math.max(Math.min(60_000, base * 2 ** ++failures), retryAfter * 1000);
      }
      if (!isCancelled()) timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentTrack?.id, canPollQueue, sdkActive, queueVersion]);

  // Dynamic ambient palette extraction from album art
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

  const handleReorderQueue = async (newQueue: Track[]) => {
    try {
      const data = await reorderDemoQueue(newQueue);
      setQueue(data.queue);
      showToast('Demo queue order updated.');
      return true;
    } catch (err) {
      showToast(errorMessage(err));
      return false;
    }
  };

  const handlePlaySongNow = async (trackId: string | undefined, track: Track) => {
    try {
      const data = await playDemoTrackNow(String(trackId));
      setQueue(data.remainingQueue);
      await refreshPlayback();
      showToast(`Demo playing: ${track.name || track.title}`);
    } catch (err) {
      showToast(errorMessage(err));
    }
  };

  let sessionStatus: string | undefined = isAuthenticated ? 'Select a Spotify device' : 'Sign in to Spotify';
  if (isDemoMode) sessionStatus = 'Demo session';
  else if (isLoading) sessionStatus = 'Connecting...';
  else if (isReady) sessionStatus = playbackState?.device?.name;

  let footerStatus = 'Spotify browser player';
  if (isDemoMode) footerStatus = 'DEMO / simulated playback';
  else if (audioRoute === 'airplay') footerStatus = 'AirPlay from this tablet';
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
            <span>Your people. Your soundtrack.</span>
          </div>
        </div>
        <div className="session-status" role="status">
          <span className={`status-dot ${isReady ? '' : 'status-dot-idle'}`} />
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
            aria-pressed={showLyrics}
            title="Show the lyrics of the current song"
          >
            <MicVocal size={15} />
            <span>Lyrics</span>
          </button>
          <button
            type="button"
            onClick={() => setIsJamSettingsOpen(true)}
            className="button button-primary header-jam-button"
          >
            Jam in Spotify <ArrowUpRight size={15} />
          </button>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="icon-button"
            title="Settings & Skins"
            aria-label="Open settings and skins"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {isOffline && <OfflineBanner />}
      {!isOffline && (error || (!isLoading && !isDemoMode && !isAuthenticated)) && (
        <div className="connection-banner" role={error ? 'alert' : 'status'}>
          <span>{error || 'Connect your Spotify account in Settings. Demo mode is off.'}</span>
          <button type="button" onClick={() => setIsSettingsOpen(true)}>
            Settings
          </button>
        </div>
      )}

      <main className="listening-room">
        <section className="player-section" aria-label="Now playing">
          <AlbumArtPlayer
            playback={playbackState}
            isPlaying={isPlaying}
            onPlayPause={togglePlay}
            onNext={nextTrack}
            onPrevious={previousTrack}
            onSeek={seek}
            onVolumeChange={(vol: number) => setVolume(vol / 100)}
            theme={theme}
            isDemoMode={isDemoMode}
            controlsEnabled={(isDemoMode || isAuthenticated) && !playbackState?.device?.is_restricted}
          />
        </section>

        {showLyrics ? (
          <section className="queue-section" aria-label="Lyrics">
            <LyricsPanel
              track={currentTrack}
              progressMs={playbackState?.progress_ms ?? playbackState?.position ?? 0}
              onClose={() => toggleLyrics(false)}
            />
          </section>
        ) : (
          <section className="queue-section" aria-label="Upcoming tracks">
            <SpotifyJamQueue
              queue={queue}
              onReorderQueue={handleReorderQueue}
              onPlaySongNow={handlePlaySongNow}
              onOpenJamSettings={() => setIsJamSettingsOpen(true)}
              theme={theme}
              isDemoMode={isDemoMode}
              error={queueError}
            />
          </section>
        )}
      </main>

      <footer className="app-footer">
        <span>
          <span className="status-dot" /> {footerStatus}
        </span>
        <span className="footer-clock">
          <Clock size={12} /> {currentTime}
        </span>
        <span>POWERED BY SPOTIFY</span>
      </footer>

      {toastMessage && (
        <div className="app-toast" role="status">
          {toastMessage}
        </div>
      )}

      {/* Speaker Selector Modal (Bluetooth / Sonos / AirPlay) */}
      <SpeakerSelectorModal
        isOpen={isSpeakerModalOpen}
        onClose={() => setIsSpeakerModalOpen(false)}
        onSelectSpeaker={(id: string) => transferPlayback(id)}
        browserDeviceId={browserDeviceId}
        isDemoMode={isDemoMode}
        canUseAirPlay={canUseAirPlay}
        audioRoute={audioRoute}
        onAudioRouteChange={changeAudioRoute}
      />

      <JamSettingsModal isOpen={isJamSettingsOpen} onClose={() => setIsJamSettingsOpen(false)} />

      {/* General Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        authInfo={{
          authenticated: isAuthenticated,
          demoMode: isDemoMode,
          playbackMode
        }}
        signInError={signInError}
        currentTheme={theme}
        onThemeChange={handleThemeChange}
      />
    </div>
  );
}
