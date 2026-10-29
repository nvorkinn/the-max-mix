import { useEffect, useRef, useState, useCallback } from 'react';
import { requestJSON, postJSON } from '../utils/api.js';
import { loadSpotifySDK } from '../utils/spotifySdk.js';

export function useSpotifyPlayer() {
  const [config, setConfig] = useState(/** @type {import('../types.js').ServerConfig | null} */ (null));
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [playbackState, setPlaybackState] = useState(/** @type {import('../types.js').PlaybackState | null} */ (null));
  const [browserDeviceId, setBrowserDeviceId] = useState(/** @type {string | null} */ (null));
  const [connectionError, setConnectionError] = useState(/** @type {string | null} */ (null));
  const [actionError, setActionError] = useState(() => new URLSearchParams(location.search).get('auth_error'));
  const [sdkError, setSdkError] = useState(/** @type {string | null} */ (null));
  const playbackRequestRef = useRef(0);

  // Bumping the counter makes any in-flight playback request discard its result.
  const invalidatePlayback = useCallback(() => {
    playbackRequestRef.current++;
  }, []);

  const refreshPlayback = useCallback(async () => {
    const requestId = ++playbackRequestRef.current;
    const state = /** @type {import('../types.js').PlaybackState | null} */ (await requestJSON('/api/spotify/current'));
    if (requestId === playbackRequestRef.current) setPlaybackState(state);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Read through a function: TypeScript narrows the flag to `false` and cannot see the cleanup flip it mid-await.
    const isCancelled = () => cancelled;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    let failures = 0;
    const poll = async () => {
      let delay = 4000;
      try {
        const info = /** @type {import('../types.js').ServerConfig} */ (await requestJSON('/api/info'));
        if (isCancelled()) return;
        setConfig(info);
        /** @type {import('../types.js').TokenStatus} */
        const auth = info.demoMode
          ? { authenticated: false }
          : /** @type {import('../types.js').TokenStatus} */ (await requestJSON('/api/token'));
        if (isCancelled()) return;
        setIsAuthenticated(auth.authenticated);
        if (info.demoMode || auth.authenticated) await refreshPlayback();
        else setPlaybackState(null);
        if (!isCancelled()) setConnectionError(null);
        failures = 0;
      } catch (error) {
        if (isCancelled()) return;
        const apiError = /** @type {import('../types.js').ApiError} */ (error);
        setConnectionError(apiError.message);
        if (apiError.status === 401) {
          setIsAuthenticated(false);
          setPlaybackState(null);
        }
        delay = Math.max(Math.min(60000, 4000 * 2 ** ++failures), (apiError.retryAfter ?? 0) * 1000 || 0);
      }
      if (!isCancelled()) timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => {
      cancelled = true;
      invalidatePlayback();
      clearTimeout(timer);
    };
  }, [refreshPlayback, invalidatePlayback]);

  useEffect(() => {
    if (!isAuthenticated || config?.demoMode || config?.playbackMode !== 'browser') return;
    let cancelled = false;
    // Read through a function: TypeScript narrows the flag to `false` and cannot see the cleanup flip it mid-await.
    const isCancelled = () => cancelled;
    /** @type {import('../types.js').SpotifyPlayer | undefined} */
    let player;
    const initialize = async () => {
      try {
        const sdk = await loadSpotifySDK();
        if (isCancelled()) return;
        player = new sdk.Player({
          name: 'THE MAX MIX',
          getOAuthToken: (/** @type {(token: string) => void} */ callback) => {
            requestJSON('/api/token')
              .then(response => {
                const data = /** @type {import('../types.js').TokenStatus} */ (response);
                if (data.token) callback(data.token);
                else if (!isCancelled()) setSdkError('Spotify login expired. Sign in again in Settings.');
              })
              .catch((/** @type {unknown} */ error) => {
                if (!isCancelled()) setSdkError(/** @type {Error} */ (error).message);
              });
          },
          volume: 0.8
        });
        player.addListener('ready', (/** @type {{ device_id: string }} */ { device_id }) => {
          if (isCancelled()) return;
          setBrowserDeviceId(device_id);
          setSdkError(null);
        });
        player.addListener('not_ready', () => {
          if (isCancelled()) return;
          setBrowserDeviceId(null);
          setSdkError('The tablet player disconnected. Check the connection or select another speaker.');
        });
        for (const event of ['initialization_error', 'authentication_error', 'account_error', 'playback_error']) {
          player.addListener(event, (/** @type {{ message: string }} */ { message }) => {
            if (!isCancelled()) {
              setSdkError(
                `Browser playback: ${message} Remote playback mode is available if this Pi cannot stream audio.`
              );
            }
          });
        }
        if (!(await player.connect()) && !isCancelled()) setSdkError('Could not connect the tablet player to Spotify.');
      } catch (error) {
        if (!isCancelled()) setSdkError(/** @type {Error} */ (error).message);
      }
    };
    void initialize();
    return () => {
      cancelled = true;
      player?.disconnect();
      setBrowserDeviceId(null);
    };
  }, [isAuthenticated, config?.demoMode, config?.playbackMode]);

  const runCommand = useCallback(
    /**
     * @param {string} action
     * @param {object} [body]
     */
    async (action, body) => {
      try {
        await postJSON(`/api/spotify/${action}`, body);
        await refreshPlayback();
        setActionError(null);
        return true;
      } catch (error) {
        setActionError(/** @type {Error} */ (error).message);
        return false;
      }
    },
    [refreshPlayback]
  );

  /** @param {string} deviceId */
  const transferPlayback = async deviceId => {
    try {
      await postJSON('/api/transfer', { deviceId, play: false });
      await refreshPlayback();
      setActionError(null);
      return true;
    } catch (error) {
      setActionError(/** @type {Error} */ (error).message);
      throw error;
    }
  };

  return {
    playbackState,
    browserDeviceId,
    isAuthenticated,
    isDemoMode: Boolean(config?.demoMode),
    isConfigured: Boolean(config?.spotifyConfigured),
    playbackMode: config?.playbackMode,
    isLoading: !config,
    isReady: Boolean(playbackState?.device),
    error: actionError || connectionError || sdkError,
    clearError: () => setActionError(null),
    togglePlay: () => runCommand(playbackState?.is_playing ? 'pause' : 'play'),
    nextTrack: () => runCommand('next'),
    previousTrack: () => runCommand('previous'),
    seek: (/** @type {number} */ position) => runCommand('seek', { position_ms: Math.round(position) }),
    setVolume: (/** @type {number} */ volume) => runCommand('volume', { volume_percent: Math.round(volume * 100) }),
    transferPlayback,
    refreshPlayback
  };
}
