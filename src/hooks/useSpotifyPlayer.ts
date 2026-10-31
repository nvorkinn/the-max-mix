import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { PlaybackState, SdkPlaybackState, SpotifyPlayer, Track } from '../types';
import * as spotify from '../spotify/api';
import { getAccessToken, isSignedIn } from '../spotify/auth';
import { NETWORK_ERROR_MESSAGE, SpotifyApiError } from '../spotify/http';
import { getPlaybackMode } from '../spotify/settings';
import { errorMessage } from '../utils/errorMessage';
import { loadSpotifySDK } from '../utils/spotifySdk';
import { widevineProblem } from '../utils/widevine';
import { debugLog } from '../utils/debugLog';

// Spotify's playback state lags a play/pause command by a second or more, so a read right after one still reports the
// old state. For this long after a command the button keeps the state the command asked for.
const EXPECTED_PLAYING_MS = 5000;
// While another device plays there are no SDK events, so the state is read this often.
const REMOTE_POLL_MS = 4000;
// While this page is the active SDK player the events carry the changes; this is only a safety net.
const SDK_POLL_MS = 30_000;
// An SDK command that has not answered by now is given up on, so one lost reply cannot leave the buttons dead.
const SDK_COMMAND_TIMEOUT_MS = 8000;

/** Rejects when `promise` has not settled within `ms`. */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

type PlaybackOrNull = PlaybackState | null;

export interface PlaybackProblem {
  message: string;
  recovery: 'sign-in' | 'choose-speaker' | 'settings' | 'reconnect' | 'refresh' | 'enable-audio' | 'wait';
}

function apiProblem(error: unknown): PlaybackProblem {
  let recovery: PlaybackProblem['recovery'] = 'refresh';
  if (error instanceof SpotifyApiError) {
    switch (error.status) {
      case 401: {
        recovery = 'sign-in';
        break;
      }
      case 403: {
        recovery = 'settings';
        break;
      }
      case 404: {
        recovery = 'choose-speaker';
        break;
      }
      case 429: {
        recovery = 'wait';
        break;
      }
      default:
    }
    if (error instanceof SpotifyApiError && error.retryAfter > 0) recovery = 'wait';
  }
  return { message: errorMessage(error), recovery };
}

/** What the hook gives the components. */
export interface UseSpotifyPlayer {
  playbackState: PlaybackOrNull;
  browserDeviceId: string | null;
  isAuthenticated: boolean;
  playbackMode: ReturnType<typeof getPlaybackMode>;
  isLoading: boolean;
  isConnecting: boolean;
  isReady: boolean;
  sdkActive: boolean;
  queueVersion: number;
  error: string | null;
  problem: PlaybackProblem | null;
  clearError: () => void;
  togglePlay: () => Promise<boolean>;
  nextTrack: () => Promise<boolean>;
  previousTrack: () => Promise<boolean>;
  seek: (position: number) => Promise<boolean>;
  setVolume: (volume: number) => Promise<boolean>;
  transferPlayback: (deviceId: string) => Promise<boolean>;
  refreshPlayback: () => Promise<void>;
  retryPlayback: () => Promise<boolean>;
  reconnectPlayer: () => void;
  allowBrowserAudio: () => Promise<boolean>;
}

/**
 * A playback state moved on to `now`: while playing, the progress keeps growing between events without any request.
 * `at` is when `state` was received.
 */
function project(state: PlaybackOrNull, at: number, now: number): PlaybackOrNull {
  if (!state?.is_playing) return state;
  const progress = (state.progress_ms ?? state.position ?? 0) + Math.max(0, now - at);
  const duration = state.item?.duration_ms ?? state.duration;
  return { ...state, progress_ms: duration ? Math.min(duration, progress) : progress };
}

/**
 * `state` with a new playing flag. Spotify's `actions.disallows` says "resuming" while playing and "pausing" while
 * paused, so after the flag is changed here (by a press or an SDK event) those two are out of date and are dropped;
 * left in, they would keep the Play button disabled until the next read from Spotify.
 */
function withPlaying(state: PlaybackState, playing: boolean): PlaybackState {
  const disallows = Object.fromEntries(
    Object.entries(state.actions?.disallows ?? {}).filter(([action]) => action !== 'pausing' && action !== 'resuming')
  );
  return { ...state, is_playing: playing, actions: { ...state.actions, disallows } };
}

function nextTracksKey(state: SdkPlaybackState): string {
  return (state?.track_window?.next_tracks ?? []).map(track => track.id ?? track.uri ?? '').join(',');
}

export function useSpotifyPlayer(): UseSpotifyPlayer {
  // Settings change only through a reload, so they are read once. The one exception: a browser that cannot play
  // (no Widevine) drops to remote mode for this page, without changing the stored setting.
  const [playbackMode, setPlaybackMode] = useState(getPlaybackMode);
  const [isAuthenticated, setIsAuthenticated] = useState(isSignedIn);
  const [snapshot, setSnapshot] = useState<{ state: PlaybackOrNull; at: number }>({ state: null, at: 0 });
  const [now, setNow] = useState(Date.now);
  const [loaded, setLoaded] = useState(false);
  const [browserDeviceId, setBrowserDeviceId] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<PlaybackProblem | null>(null);
  const [actionError, setActionError] = useState<PlaybackProblem | null>(null);
  const [sdkError, setSdkError] = useState<PlaybackProblem | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionVersion, setConnectionVersion] = useState(0);
  // True while the SDK reports this player as the active device (it reports null once another device takes over).
  const [sdkActive, setSdkActive] = useState(false);
  // True once a different device was picked under Speakers: play/pause then go to that device through the Web API.
  const [remoteSelected, setRemoteSelected] = useState(false);
  // Counts the moments the queue is likely to have changed, so the queue view re-reads it.
  const [queueVersion, setQueueVersion] = useState(0);
  const playbackRequestRef = useRef(0);
  const expectedPlayingRef = useRef<{ playing: boolean; until: number } | null>(null);
  const playPauseInFlightRef = useRef(false);
  // The Web Playback SDK player this page runs ("The Max Mix"), once it is connected.
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const sdkActiveRef = useRef(false);
  const lastTrackIdRef = useRef<string | null>(null);
  const lastNextTracksRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const retryAfterRef = useRef(0);
  // Brings the SDK player back in step after the page was in the background (set while the player exists).
  const resumeRef = useRef<(() => void) | null>(null);

  const problemForApi = useCallback((error: unknown) => {
    if (error instanceof SpotifyApiError && error.retryAfter > 0) {
      retryAfterRef.current = Date.now() + error.retryAfter * 1000;
    }
    return apiProblem(error);
  }, []);
  const checkRetryWindow = useCallback(() => {
    const remaining = retryAfterRef.current - Date.now();
    if (remaining > 0) {
      throw new SpotifyApiError('Spotify asked this app to wait before retrying.', 429, Math.ceil(remaining / 1000));
    }
  }, []);

  const setPlayback = useCallback((next: PlaybackOrNull | ((current: PlaybackOrNull) => PlaybackOrNull)) => {
    const at = Date.now();
    setSnapshot(previous => {
      const current = project(previous.state, previous.at, at);
      return { state: typeof next === 'function' ? next(current) : next, at };
    });
  }, []);

  const playbackState = useMemo(() => project(snapshot.state, snapshot.at, now), [snapshot, now]);
  const isPlayingNow = Boolean(snapshot.state?.is_playing);
  // Moves the progress bar between events; it makes no request.
  useEffect(() => {
    if (!isPlayingNow) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isPlayingNow]);

  const markSdkActive = useCallback((active: boolean) => {
    sdkActiveRef.current = active;
    setSdkActive(active);
  }, []);
  const bumpQueue = useCallback(() => setQueueVersion(version => version + 1), []);

  // Bumping the counter makes any in-flight playback request discard its result.
  const invalidatePlayback = useCallback(() => {
    playbackRequestRef.current++;
  }, []);

  // Keeps the button on `playing` against reads that predate it, until Spotify agrees or the hold runs out.
  const holdPlaying = useCallback((playing: boolean) => {
    expectedPlayingRef.current = { playing, until: Date.now() + EXPECTED_PLAYING_MS };
    playbackRequestRef.current++;
  }, []);

  const refreshPlayback = useCallback(async () => {
    const requestId = ++playbackRequestRef.current;
    checkRetryWindow();
    const state = await spotify.getPlaybackState();
    if (requestId !== playbackRequestRef.current) return;
    setConnectionError(null);
    setActionError(current =>
      current?.message === NETWORK_ERROR_MESSAGE || current?.recovery === 'wait' ? null : current
    );
    const expected = expectedPlayingRef.current;
    if (expected && state) {
      // Spotify agreeing, or the window passing, ends the hold; until then a stale read must not flip the button back.
      if (state.is_playing === expected.playing || Date.now() > expected.until) expectedPlayingRef.current = null;
      else {
        setPlayback(withPlaying(state, expected.playing));
        return;
      }
    }
    setPlayback(state);
  }, [setPlayback, checkRetryWindow]);

  const reportConnectionError = useCallback(
    (error: unknown) => {
      setConnectionError(problemForApi(error));
      if (error instanceof SpotifyApiError && error.status === 401 && !isSignedIn()) {
        setIsAuthenticated(false);
        setPlayback(null);
      }
    },
    [setPlayback, problemForApi]
  );

  // Refreshing confirms state only: resending a skip after an uncertain reply could skip a second track.
  const retryPlayback = async () => {
    try {
      await refreshPlayback();
      setConnectionError(null);
      setActionError(null);
      bumpQueue();
      return true;
    } catch (error) {
      reportConnectionError(error);
      return false;
    } finally {
      setLoaded(true);
    }
  };

  // Reads playback from Spotify: at once, then every 4 s while another device plays, and only as a slow safety
  // net while this page's SDK player is active and tells us about every change itself.
  const sdkDriven = sdkActive && !remoteSelected;
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    // Read through a function: TypeScript narrows the flag to `false` and cannot see the cleanup flip it mid-await.
    const isCancelled = () => cancelled;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const poll = async () => {
      const base = sdkDriven ? SDK_POLL_MS : REMOTE_POLL_MS;
      let delay = base;
      try {
        await refreshPlayback();
        if (isCancelled()) return;
        setConnectionError(null);
        failures = 0;
      } catch (error) {
        if (isCancelled()) return;
        reportConnectionError(error);
        const apiError = error instanceof SpotifyApiError ? error : null;
        delay = Math.max(Math.min(60_000, base * 2 ** ++failures), (apiError?.retryAfter ?? 0) * 1000);
      }
      setLoaded(true);
      if (!isCancelled()) timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => {
      cancelled = true;
      invalidatePlayback();
      clearTimeout(timer);
    };
  }, [isAuthenticated, sdkDriven, refreshPlayback, invalidatePlayback, reportConnectionError]);

  // A background tab's timers are throttled to about one a minute and its connections can drop, so when the page comes
  // back to the front it reads everything again at once instead of waiting for the next (late) timer.
  useEffect(() => {
    if (!isAuthenticated) return;
    const wake = () => {
      if (document.visibilityState === 'hidden') return;
      refreshPlayback().catch(() => {});
      bumpQueue();
      resumeRef.current?.();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
    };
  }, [isAuthenticated, refreshPlayback, bumpQueue]);

  useEffect(() => {
    if (!isAuthenticated || playbackMode !== 'browser') return;
    let cancelled = false;
    // Read through a function: TypeScript narrows the flag to `false` and cannot see the cleanup flip it mid-await.
    const isCancelled = () => cancelled;
    let player: SpotifyPlayer | undefined;

    const applySdkState = (state: SdkPlaybackState) => {
      if (isCancelled()) return;
      markSdkActive(Boolean(state));
      if (!state) return;
      holdPlaying(!state.paused);
      if (!state.paused) setSdkError(null);
      const track: Track | undefined = state.track_window?.current_track;
      const trackId = track?.id ?? null;
      setPlayback(current => ({
        ...withPlaying(current ?? {}, !state.paused),
        progress_ms: state.position,
        ...(state.duration !== undefined && { duration: state.duration }),
        // The Web API's track has more detail than the SDK's, so it is only replaced when the track changed.
        ...(track && current?.item?.id !== track.id && { item: track })
      }));
      if (trackId !== lastTrackIdRef.current) {
        lastTrackIdRef.current = trackId;
        // The device and the rest of the details come from the Web API; read them now, not at the next safety poll.
        refreshPlayback().catch(() => {});
      }
      const key = nextTracksKey(state);
      if (key !== lastNextTracksRef.current) {
        lastNextTracksRef.current = key;
        bumpQueue();
      }
    };

    const disconnect = () => {
      cancelled = true;
      player?.disconnect();
      playerRef.current = null;
      resumeRef.current = null;
      deviceIdRef.current = null;
      sdkActiveRef.current = false;
      lastTrackIdRef.current = null;
      lastNextTracksRef.current = null;
      setSdkActive(false);
      setBrowserDeviceId(null);
      setIsConnecting(false);
    };

    const initialize = async () => {
      setIsConnecting(true);
      setSdkError(null);
      try {
        const sdk = await loadSpotifySDK();
        if (isCancelled()) return;
        player = new sdk.Player({
          name: 'The Max Mix',
          getOAuthToken: callback => {
            getAccessToken()
              .then(token => {
                if (token) callback(token);
                else if (!isCancelled()) {
                  setIsConnecting(false);
                  setSdkError({ message: 'Spotify login expired. Sign in again in Settings.', recovery: 'sign-in' });
                }
              })
              .catch((error: unknown) => {
                if (!isCancelled()) {
                  setIsConnecting(false);
                  const problem = apiProblem(error);
                  setSdkError({ ...problem, recovery: problem.recovery === 'sign-in' ? 'sign-in' : 'reconnect' });
                }
              });
          },
          volume: 0.8
        });
        // The SDK reports every change at once, which the Web API's state endpoint only does a second or so later.
        player.addListener('player_state_changed', applySdkState);
        player.addListener('ready', ({ device_id }: { device_id: string }) => {
          if (isCancelled()) return;
          debugLog('info', 'sdk', `Browser player ready as device ${device_id}`);
          deviceIdRef.current = device_id;
          setBrowserDeviceId(device_id);
          setIsConnecting(false);
          setSdkError(null);
          refreshPlayback().catch(() => {});
          bumpQueue();
          // No state only means this page is not the active device yet; it must not undo what an event said.
          player
            ?.getCurrentState()
            .then(state => {
              if (state) applySdkState(state);
            })
            .catch(() => {});
        });
        player.addListener('not_ready', () => {
          if (isCancelled()) return;
          debugLog('warn', 'sdk', 'Browser player went offline (not_ready)');
          deviceIdRef.current = null;
          setBrowserDeviceId(null);
          markSdkActive(false);
          setIsConnecting(false);
          setSdkError({
            message: 'The tablet player disconnected. Check the connection or select another speaker.',
            recovery: 'reconnect'
          });
        });
        player.addListener('autoplay_failed', () => {
          if (!isCancelled()) {
            setIsConnecting(false);
            setSdkError({
              message: 'The browser blocked autoplay. Tap Play on the screen to start the music.',
              recovery: 'enable-audio'
            });
          }
        });
        for (const event of ['initialization_error', 'authentication_error', 'account_error', 'playback_error']) {
          player.addListener(event, ({ message }: { message: string }) => {
            if (isCancelled()) return;
            debugLog('error', 'sdk', `${event}: ${message}`);
            setIsConnecting(false);
            let recovery: PlaybackProblem['recovery'] = 'settings';
            if (event === 'authentication_error') recovery = 'sign-in';
            else if (event === 'playback_error') recovery = 'reconnect';
            const showError = (reason: string | null, hint: string, action: PlaybackProblem['recovery'] = recovery) =>
              setSdkError({
                message: [`Browser playback: ${message}`, reason, hint].filter(Boolean).join(' '),
                recovery: action
              });
            showError(null, 'Remote playback mode is available if this Pi cannot stream audio.');
            // A player that cannot start is nearly always missing Widevine; ask the browser and say so if it is. This
            // browser then cannot be the speaker, so the page only controls another Spotify Connect device.
            if (event === 'initialization_error') {
              void widevineProblem().then(reason => {
                if (!reason || isCancelled()) return;
                showError(
                  reason,
                  'Switched to remote playback: choose a Spotify device under Speakers.',
                  'choose-speaker'
                );
                setPlaybackMode('remote');
              });
            }
          });
        }
        debugLog('info', 'sdk', 'Connecting the browser player');
        const connected = await withTimeout(
          player.connect(),
          SDK_COMMAND_TIMEOUT_MS,
          'The tablet player did not connect. Try reconnecting.'
        );
        if (isCancelled()) return;
        resumeRef.current = () => {
          // A dropped player registers again by connecting; a live one only needs its current state read.
          if (!deviceIdRef.current) player?.connect().catch(() => {});
          player
            ?.getCurrentState()
            .then(state => {
              if (state) applySdkState(state);
            })
            .catch(() => {});
        };
        if (connected) playerRef.current = player;
        else if (!isCancelled()) {
          setIsConnecting(false);
          setSdkError({ message: 'Could not connect the tablet player to Spotify.', recovery: 'reconnect' });
        }
      } catch (error) {
        if (!isCancelled()) {
          disconnect();
          setSdkError(current => current ?? { message: errorMessage(error), recovery: 'reconnect' });
        }
      }
    };
    void initialize();
    return disconnect;
  }, [
    isAuthenticated,
    playbackMode,
    holdPlaying,
    refreshPlayback,
    setPlayback,
    markSdkActive,
    bumpQueue,
    connectionVersion
  ]);

  const runCommand = useCallback(
    async (command: () => Promise<unknown>) => {
      try {
        checkRetryWindow();
        await command();
        await refreshPlayback();
        setActionError(null);
        return true;
      } catch (error) {
        setActionError(problemForApi(error));
        return false;
      }
    },
    [refreshPlayback, checkRetryWindow, problemForApi]
  );

  // The SDK player is the one to drive while this page is the player: browser mode, connected, and no other device
  // picked under Speakers. Otherwise commands go to the active device through the Web API.
  const sdkPlayer = () => (browserDeviceId && !remoteSelected ? playerRef.current : null);
  const isThisPlayerActive = () =>
    sdkActiveRef.current || Boolean(browserDeviceId && playbackState?.device?.id === browserDeviceId);

  /** Runs an SDK transport command; its state change arrives as a `player_state_changed` event. */
  const runSdkCommand = async (command: (player: SpotifyPlayer) => Promise<void>) => {
    const player = sdkPlayer();
    if (!player || !isThisPlayerActive()) return null;
    try {
      await withTimeout(command(player), SDK_COMMAND_TIMEOUT_MS, 'Spotify did not answer. Try again.');
      setActionError(null);
      return true;
    } catch (error) {
      setActionError(problemForApi(error));
      // The player may have dropped; reconnect it and read where it really is.
      resumeRef.current?.();
      return false;
    }
  };

  /** Moves playback to a device through the Web API and brings the state up to date. */
  const transferTo = useCallback(
    async (deviceId: string, play: boolean) => {
      checkRetryWindow();
      await spotify.transferPlayback(deviceId, play);
      const toThisPage = deviceId === browserDeviceId;
      setRemoteSelected(!toThisPage);
      // This page's player is now the active device: later presses use the SDK, not another transfer.
      if (toThisPage) markSdkActive(true);
      await refreshPlayback();
      bumpQueue();
      setActionError(null);
    },
    [browserDeviceId, markSdkActive, refreshPlayback, bumpQueue, checkRetryWindow]
  );

  // Flips the button at once and holds that state against stale reads; a second press while the first command is still
  // in flight is ignored (it would otherwise send the same command twice and Spotify refuses the second).
  const togglePlay = async () => {
    if (playPauseInFlightRef.current) return false;
    playPauseInFlightRef.current = true;
    const playing = !playbackState?.is_playing;
    const previous = playbackState;
    holdPlaying(playing);
    setPlayback(current => (current ? withPlaying(current, playing) : current));
    try {
      const player = sdkPlayer();
      // Browsers only start audio from a user gesture, and this press is one.
      player?.activateElement().catch(() => {});
      let ok: boolean;
      if (player && isThisPlayerActive()) ok = (await runSdkCommand(active => active.togglePlay())) === true;
      else if (player && playing && browserDeviceId) {
        // Not the active device yet: the first Play makes this page the player (on a press, so loading the page
        // never takes over what is playing elsewhere).
        try {
          await transferTo(browserDeviceId, true);
          ok = true;
        } catch (error) {
          setActionError(problemForApi(error));
          ok = false;
        }
      } else ok = await runCommand(() => (playing ? spotify.play() : spotify.pause()));
      if (!ok) {
        expectedPlayingRef.current = null;
        setPlayback(previous);
      }
      return ok;
    } finally {
      playPauseInFlightRef.current = false;
    }
  };

  const transport = async (command: (player: SpotifyPlayer) => Promise<void>, apiCommand: () => Promise<unknown>) =>
    (await runSdkCommand(command)) ?? runCommand(apiCommand);

  const transferPlayback = async (deviceId: string) => {
    try {
      await transferTo(deviceId, false);
      return true;
    } catch (error) {
      setActionError(problemForApi(error));
      throw error;
    }
  };

  const allowBrowserAudio = async () => {
    const player = playerRef.current;
    if (!player) {
      setSdkError({ message: 'The browser player is not connected.', recovery: 'reconnect' });
      return false;
    }
    try {
      await withTimeout(
        player.activateElement(),
        SDK_COMMAND_TIMEOUT_MS,
        'The browser did not enable audio. Try again.'
      );
      setSdkError(null);
      return true;
    } catch (error) {
      setSdkError({ message: errorMessage(error), recovery: 'enable-audio' });
      return false;
    }
  };

  const problem = actionError ?? connectionError ?? sdkError;
  return {
    playbackState,
    browserDeviceId,
    isAuthenticated,
    playbackMode,
    isLoading: isAuthenticated && !loaded,
    isConnecting,
    isReady: Boolean(playbackState?.device),
    sdkActive: sdkDriven,
    queueVersion,
    error: problem?.message ?? null,
    problem,
    clearError: () => setActionError(null),
    togglePlay,
    nextTrack: () =>
      transport(
        player => player.nextTrack(),
        () => spotify.next()
      ),
    previousTrack: () =>
      transport(
        player => player.previousTrack(),
        () => spotify.previous()
      ),
    seek: (position: number) =>
      transport(
        player => player.seek(Math.round(position)),
        () => spotify.seek(Math.round(position))
      ),
    setVolume: (volume: number) =>
      transport(
        player => player.setVolume(volume),
        () => spotify.setVolume(Math.round(volume * 100))
      ),
    transferPlayback,
    refreshPlayback,
    retryPlayback,
    allowBrowserAudio,
    reconnectPlayer: () => setConnectionVersion(version => version + 1)
  };
}
