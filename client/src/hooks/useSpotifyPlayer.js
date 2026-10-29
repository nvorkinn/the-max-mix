import { useEffect, useRef, useState, useCallback } from 'react';
import { requestJSON, postJSON } from '../utils/api.js';
import { loadSpotifySDK } from '../utils/spotifySdk.js';

// Spotify's playback state lags a play/pause command by a second or more, so a read right after one still reports the
// old state. For this long after a command the button keeps the state the command asked for.
const EXPECTED_PLAYING_MS = 5000;

export function useSpotifyPlayer() {
  const [config, setConfig] = useState(/** @type {import('../types.js').ServerConfig | null} */ (null));
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [playbackState, setPlaybackState] = useState(/** @type {import('../types.js').PlaybackState | null} */ (null));
  const [browserDeviceId, setBrowserDeviceId] = useState(/** @type {string | null} */ (null));
  const [connectionError, setConnectionError] = useState(/** @type {string | null} */ (null));
  const [actionError, setActionError] = useState(() => new URLSearchParams(location.search).get('auth_error'));
  const [sdkError, setSdkError] = useState(/** @type {string | null} */ (null));
  const playbackRequestRef = useRef(0);
  const expectedPlayingRef = useRef(/** @type {{ playing: boolean, until: number } | null} */ (null));
  const playPauseInFlightRef = useRef(false);
  // The Web Playback SDK player this page runs ("THE MAX MIX"), once it is connected.
  const playerRef = useRef(/** @type {import('../types.js').SpotifyPlayer | null} */ (null));
  // True while the SDK reports this player as the active device (it reports null once another device takes over).
  const sdkActiveRef = useRef(false);
  const lastTrackIdRef = useRef(/** @type {string | null} */ (null));
  // True once a different device was picked under Speakers: play/pause then go to that device through the Web API.
  const remoteSelectedRef = useRef(false);

  // Bumping the counter makes any in-flight playback request discard its result.
  const invalidatePlayback = useCallback(() => {
    playbackRequestRef.current++;
  }, []);

  // Keeps the button on `playing` against reads that predate it, until Spotify agrees or the hold runs out.
  const holdPlaying = useCallback(
    /** @param {boolean} playing */
    playing => {
      expectedPlayingRef.current = { playing, until: Date.now() + EXPECTED_PLAYING_MS };
      playbackRequestRef.current++;
    },
    []
  );

  const refreshPlayback = useCallback(async () => {
    const requestId = ++playbackRequestRef.current;
    const state = /** @type {import('../types.js').PlaybackState | null} */ (await requestJSON('/api/spotify/current'));
    if (requestId !== playbackRequestRef.current) return;
    const expected = expectedPlayingRef.current;
    if (expected && state) {
      // Spotify agreeing, or the window passing, ends the hold; until then a stale read must not flip the button back.
      if (state.is_playing === expected.playing || Date.now() > expected.until) expectedPlayingRef.current = null;
      else {
        setPlaybackState({ ...state, is_playing: expected.playing });
        return;
      }
    }
    setPlaybackState(state);
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
        // The SDK reports every change at once, which the Web API's state endpoint only does a second or so later.
        player.addListener('player_state_changed', (/** @type {import('../types.js').SdkPlaybackState} */ state) => {
          if (isCancelled()) return;
          sdkActiveRef.current = Boolean(state);
          if (!state) return;
          holdPlaying(!state.paused);
          setPlaybackState(current =>
            current ? { ...current, is_playing: !state.paused, progress_ms: state.position } : current
          );
          const trackId = state.track_window?.current_track?.id ?? null;
          if (trackId !== lastTrackIdRef.current) {
            lastTrackIdRef.current = trackId;
            // The track, its art and the device come from the Web API; fetch them now, not at the next poll.
            refreshPlayback().catch(() => {});
          }
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
        const connected = await player.connect();
        if (connected) playerRef.current = player;
        else if (!isCancelled()) setSdkError('Could not connect the tablet player to Spotify.');
      } catch (error) {
        if (!isCancelled()) setSdkError(/** @type {Error} */ (error).message);
      }
    };
    void initialize();
    return () => {
      cancelled = true;
      player?.disconnect();
      playerRef.current = null;
      sdkActiveRef.current = false;
      setBrowserDeviceId(null);
    };
  }, [isAuthenticated, config?.demoMode, config?.playbackMode, holdPlaying, refreshPlayback]);

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

  // The SDK player is the one to drive while this page is the player: browser mode, connected, and no other device
  // picked under Speakers. Otherwise commands go to the active device through the Web API.
  const sdkPlayer = () => (browserDeviceId && !remoteSelectedRef.current ? playerRef.current : null);
  const isThisPlayerActive = () =>
    sdkActiveRef.current || Boolean(browserDeviceId && playbackState?.device?.id === browserDeviceId);

  /**
   * Runs an SDK transport command; its state change arrives as a `player_state_changed` event.
   * @param {(player: import('../types.js').SpotifyPlayer) => Promise<void>} command
   */
  const runSdkCommand = async command => {
    const player = sdkPlayer();
    if (!player || !isThisPlayerActive()) return null;
    try {
      await command(player);
      setActionError(null);
      return true;
    } catch (error) {
      setActionError(/** @type {Error} */ (error).message);
      return false;
    }
  };

  // Flips the button at once and holds that state against stale reads; a second press while the first command is still
  // in flight is ignored (it would otherwise send the same command twice and Spotify refuses the second).
  const togglePlay = async () => {
    if (playPauseInFlightRef.current) return false;
    playPauseInFlightRef.current = true;
    const playing = !playbackState?.is_playing;
    const previous = playbackState;
    holdPlaying(playing);
    setPlaybackState(current => (current ? { ...current, is_playing: playing } : current));
    try {
      const player = sdkPlayer();
      // Browsers only start audio from a user gesture, and this press is one.
      player?.activateElement().catch(() => {});
      let ok;
      if (player && isThisPlayerActive()) ok = (await runSdkCommand(active => active.togglePlay())) === true;
      else if (player && playing && browserDeviceId) {
        // Not the active device yet: the first Play makes this page the player (on a press, so loading the page
        // never takes over what is playing elsewhere).
        try {
          await postJSON('/api/transfer', { deviceId: browserDeviceId, play: true });
          await refreshPlayback();
          setActionError(null);
          ok = true;
        } catch (error) {
          setActionError(/** @type {Error} */ (error).message);
          ok = false;
        }
      } else ok = await runCommand(playing ? 'play' : 'pause');
      if (!ok) {
        expectedPlayingRef.current = null;
        setPlaybackState(previous);
      }
      return ok;
    } finally {
      playPauseInFlightRef.current = false;
    }
  };

  /**
   * @param {(player: import('../types.js').SpotifyPlayer) => Promise<void>} command
   * @param {string} action
   * @param {object} [body]
   */
  const transport = async (command, action, body) => (await runSdkCommand(command)) ?? runCommand(action, body);

  /** @param {string} deviceId */
  const transferPlayback = async deviceId => {
    try {
      await postJSON('/api/transfer', { deviceId, play: false });
      remoteSelectedRef.current = deviceId !== browserDeviceId;
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
    togglePlay,
    nextTrack: () => transport(player => player.nextTrack(), 'next'),
    previousTrack: () => transport(player => player.previousTrack(), 'previous'),
    seek: (/** @type {number} */ position) =>
      transport(player => player.seek(Math.round(position)), 'seek', { position_ms: Math.round(position) }),
    setVolume: (/** @type {number} */ volume) =>
      transport(player => player.setVolume(volume), 'volume', { volume_percent: Math.round(volume * 100) }),
    transferPlayback,
    refreshPlayback
  };
}
