import { useEffect, useRef, useState, useCallback } from 'react';
import { requestJSON, postJSON } from '../utils/api.js';
import { loadSpotifySDK } from '../utils/spotifySdk.js';

export function useSpotifyPlayer() {
  const [config, setConfig] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [playbackState, setPlaybackState] = useState(null);
  const [browserDeviceId, setBrowserDeviceId] = useState(null);
  const [connectionError, setConnectionError] = useState(null);
  const [actionError, setActionError] = useState(() => new URLSearchParams(location.search).get('auth_error'));
  const [sdkError, setSdkError] = useState(null);
  const playbackRequestRef = useRef(0);

  const refreshPlayback = useCallback(async () => {
    const requestId = ++playbackRequestRef.current;
    const state = await requestJSON('/api/spotify/current');
    if (requestId === playbackRequestRef.current) setPlaybackState(state);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer;
    let failures = 0;
    const poll = async () => {
      let delay = 4000;
      try {
        const info = await requestJSON('/api/info');
        if (cancelled) return;
        setConfig(info);
        const auth = info.demoMode ? { authenticated: false } : await requestJSON('/api/token');
        if (cancelled) return;
        setIsAuthenticated(auth.authenticated);
        if (info.demoMode || auth.authenticated) await refreshPlayback();
        else setPlaybackState(null);
        if (!cancelled) setConnectionError(null);
        failures = 0;
      } catch (error) {
        if (cancelled) return;
        setConnectionError(error.message);
        if (error.status === 401) {
          setIsAuthenticated(false);
          setPlaybackState(null);
        }
        delay = Math.max(Math.min(60000, 4000 * 2 ** ++failures), error.retryAfter * 1000 || 0);
      }
      if (!cancelled) timer = setTimeout(poll, delay);
    };
    poll();
    return () => {
      cancelled = true;
      // Intentionally the latest value: bumping the counter invalidates any in-flight request.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      playbackRequestRef.current++;
      clearTimeout(timer);
    };
  }, [refreshPlayback]);

  useEffect(() => {
    if (!isAuthenticated || config?.demoMode || config?.playbackMode !== 'browser') return;
    let cancelled = false;
    let player;
    const initialize = async () => {
      try {
        const sdk = await loadSpotifySDK();
        if (cancelled) return;
        player = new sdk.Player({
          name: 'THE MAX MIX',
          getOAuthToken: (callback) => {
            requestJSON('/api/token').then(data => {
              if (data.token) callback(data.token);
              else if (!cancelled) setSdkError('Spotify login expired. Sign in again in Settings.');
            }).catch(error => { if (!cancelled) setSdkError(error.message); });
          },
          volume: 0.8
        });
        player.addListener('ready', ({ device_id }) => {
          if (cancelled) return;
          setBrowserDeviceId(device_id);
          setSdkError(null);
        });
        player.addListener('not_ready', () => {
          if (cancelled) return;
          setBrowserDeviceId(null);
          setSdkError('The tablet player disconnected. Check the connection or select another speaker.');
        });
        for (const event of ['initialization_error', 'authentication_error', 'account_error', 'playback_error']) {
          player.addListener(event, ({ message }) => {
            if (!cancelled) setSdkError(`Browser playback: ${message} Remote playback mode is available if this Pi cannot stream audio.`);
          });
        }
        if (!await player.connect() && !cancelled) setSdkError('Could not connect the tablet player to Spotify.');
      } catch (error) {
        if (!cancelled) setSdkError(error.message);
      }
    };
    initialize();
    return () => {
      cancelled = true;
      player?.disconnect();
      setBrowserDeviceId(null);
    };
  }, [isAuthenticated, config?.demoMode, config?.playbackMode]);

  const runCommand = useCallback(async (action, body) => {
    try {
      await postJSON(`/api/spotify/${action}`, body);
      await refreshPlayback();
      setActionError(null);
      return true;
    } catch (error) {
      setActionError(error.message);
      return false;
    }
  }, [refreshPlayback]);

  const transferPlayback = async (deviceId) => {
    try {
      await postJSON('/api/transfer', { deviceId, play: false });
      await refreshPlayback();
      setActionError(null);
      return true;
    } catch (error) {
      setActionError(error.message);
      throw error;
    }
  };

  return {
    playbackState, browserDeviceId, isAuthenticated,
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
    seek: (position) => runCommand('seek', { position_ms: Math.round(position) }),
    setVolume: (volume) => runCommand('volume', { volume_percent: Math.round(volume * 100) }),
    transferPlayback, refreshPlayback
  };
}
