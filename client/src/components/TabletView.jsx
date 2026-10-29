import { useState, useEffect, useRef } from 'react';
import { AudioLines, Clock, Settings, Speaker, ArrowUpRight } from 'lucide-react';
import { useSpotifyPlayer } from '../hooks/useSpotifyPlayer.js';
import { extractPalette } from '../utils/colorExtractor.js';
import { requestJSON, postJSON } from '../utils/api.js';
import AlbumArtPlayer from './AlbumArtPlayer.jsx';
import SpotifyJamQueue from './SpotifyJamQueue.jsx';
import TouchRipples from './TouchRipples.jsx';
import SettingsModal from './SettingsModal.jsx';
import SpeakerSelectorModal from './SpeakerSelectorModal.jsx';
import JamSettingsModal from './JamSettingsModal.jsx';

const formatClock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function TabletView() {
  const {
    isReady,
    playbackState,
    isAuthenticated,
    isDemoMode,
    isConfigured,
    isLoading,
    playbackMode,
    browserDeviceId,
    error,
    refreshPlayback,
    togglePlay,
    nextTrack,
    previousTrack,
    seek,
    setVolume,
    transferPlayback
  } = useSpotifyPlayer();

  const [queue, setQueue] = useState(/** @type {import('../types.js').Track[]} */ ([]));
  const [currentTime, setCurrentTime] = useState(formatClock);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSpeakerModalOpen, setIsSpeakerModalOpen] = useState(false);
  const [isJamSettingsOpen, setIsJamSettingsOpen] = useState(false);
  const [queueError, setQueueError] = useState(/** @type {string | null} */ (null));
  const [toastMessage, setToastMessage] = useState(/** @type {string | null} */ (null));
  const [theme, setTheme] = useState(() => (localStorage.getItem('maxmix_theme') === 'minimal' ? 'minimal' : 'neon'));

  /** @param {string} newTheme */
  const handleThemeChange = newTheme => {
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
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    let failures = 0;
    const poll = async () => {
      let delay = 10000;
      try {
        const data = /** @type {import('../types.js').QueueResponse} */ (await requestJSON('/api/queue'));
        if (isCancelled()) return;
        setQueue(data.queue);
        setQueueError(null);
        failures = 0;
      } catch (caught) {
        if (isCancelled()) return;
        const apiError = /** @type {import('../types.js').ApiError} */ (caught);
        setQueueError(apiError.message);
        delay = Math.max(Math.min(60000, 10000 * 2 ** ++failures), (apiError.retryAfter ?? 0) * 1000 || 0);
      }
      if (!isCancelled()) timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentTrack?.id, canPollQueue]);

  // Dynamic ambient palette extraction from album art
  const artUrl = currentTrack?.album?.images?.[0]?.url;
  useEffect(() => {
    if (artUrl) {
      void extractPalette(artUrl).then(colors => {
        setPalette(colors);
      });
    }
  }, [artUrl]);

  const toastTimerRef = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  /** @param {string} msg */
  const showToast = msg => {
    setToastMessage(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 3500);
  };

  /** @param {import('../types.js').Track[]} newQueue */
  const handleReorderQueue = async newQueue => {
    try {
      const data = /** @type {import('../types.js').QueueResponse} */ (
        await postJSON('/api/queue/reorder', { queue: newQueue })
      );
      setQueue(data.queue);
      showToast('Demo queue order updated.');
      return true;
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
      return false;
    }
  };

  /**
   * @param {string | undefined} trackId
   * @param {import('../types.js').Track} track
   */
  const handlePlaySongNow = async (trackId, track) => {
    try {
      const data = /** @type {import('../types.js').PlayNowResponse} */ (
        await postJSON('/api/queue/play-now', { trackId })
      );
      setQueue(data.remainingQueue);
      await refreshPlayback();
      showToast(`Demo playing: ${track.name || track.title}`);
    } catch (err) {
      showToast(/** @type {Error} */ (err).message);
    }
  };

  /** @type {string | undefined} */
  let sessionStatus = isAuthenticated ? 'Select a Spotify device' : 'Sign in to Spotify';
  if (isDemoMode) sessionStatus = 'Demo session';
  else if (isLoading) sessionStatus = 'Connecting...';
  else if (isReady) sessionStatus = playbackState?.device?.name;

  let footerStatus = 'Spotify browser player';
  if (isDemoMode) footerStatus = 'DEMO / simulated playback';
  else if (playbackMode === 'remote') footerStatus = 'Spotify Connect remote';

  return (
    <div
      className="tablet-container"
      data-theme={theme}
      style={
        /** @type {import('react').CSSProperties} */ ({
          '--ambient-primary': palette.primary,
          '--ambient-secondary': palette.secondary
        })
      }
    >
      {/* 60 FPS Interactive Touch Ripple Canvas */}
      <TouchRipples theme={theme} />

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
            title="Choose a Spotify Connect device"
            aria-label="Choose a Spotify Connect device"
          >
            <Speaker size={15} />
            <span>Speakers</span>
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

      {(error || (!isLoading && !isDemoMode && !isAuthenticated)) && (
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
            onVolumeChange={(/** @type {number} */ vol) => setVolume(vol / 100)}
            theme={theme}
            isDemoMode={isDemoMode}
            controlsEnabled={(isDemoMode || isAuthenticated) && !playbackState?.device?.is_restricted}
          />
        </section>

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
        onSelectSpeaker={(/** @type {string} */ id) => transferPlayback(id)}
        browserDeviceId={browserDeviceId}
        isDemoMode={isDemoMode}
      />

      <JamSettingsModal isOpen={isJamSettingsOpen} onClose={() => setIsJamSettingsOpen(false)} />

      {/* General Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        authInfo={{
          authenticated: isAuthenticated,
          configured: isConfigured,
          demoMode: isDemoMode,
          playbackMode
        }}
        currentTheme={theme}
        onThemeChange={handleThemeChange}
      />
    </div>
  );
}
