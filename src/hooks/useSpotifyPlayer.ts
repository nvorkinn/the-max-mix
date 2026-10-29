import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { ApiError, PlaybackState, SdkPlaybackState, SpotifyPlayer, Track } from '../types';
import * as spotify from '../spotify/api';
import { getAccessToken, isSignedIn } from '../spotify/auth';
import { getClientId, getPlaybackMode, isDemoMode as readDemoMode } from '../spotify/settings';
import { loadSpotifySDK } from '../utils/spotifySdk';

// Spotify's playback state lags a play/pause command by a second or more, so a read right after one still reports the
// old state. For this long after a command the button keeps the state the command asked for.
const EXPECTED_PLAYING_MS = 5000;
// While another device plays (or in demo mode) there are no SDK events, so the state is read this often.
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

/** What the hook gives the components. */
export interface UseSpotifyPlayer {
  playbackState: PlaybackOrNull;
  browserDeviceId: string | null;
  isAuthenticated: boolean;
  isDemoMode: boolean;
  isConfigured: boolean;
  playbackMode: ReturnType<typeof getPlaybackMode>;
  isLoading: boolean;
  isReady: boolean;
  sdkActive: boolean;
  queueVersion: number;
  error: string | null;
  clearError: () => void;
  togglePlay: () => Promise<boolean>;
  nextTrack: () => Promise<boolean>;
  previousTrack: () => Promise<boolean>;
  seek: (position: number) => Promise<boolean>;
  setVolume: (volume: number) => Promise<boolean>;
  transferPlayback: (deviceId: string) => Promise<boolean>;
  refreshPlayback: () => Promise<void>;
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
  // Settings change only through a reload, so they are read once.
  const [isDemoMode] = useState(readDemoMode);
  const [playbackMode] = useState(getPlaybackMode);
  const [isConfigured] = useState(() => Boolean(getClientId()));
  const [isAuthenticated, setIsAuthenticated] = useState(isSignedIn);
  const [snapshot, setSnapshot] = useState<{ state: PlaybackOrNull; at: number }>({ state: null, at: 0 });
  const [now, setNow] = useState(Date.now);
  const [loaded, setLoaded] = useState(false);
  const [browserDeviceId, setBrowserDeviceId] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sdkError, setSdkError] = useState<string | null>(null);
  // True while the SDK reports this player as the active device (it reports null once another device takes over).
  const [sdkActive, setSdkActive] = useState(false);
  // True once a different device was picked under Speakers: play/pause then go to that device through the Web API.
  const [remoteSelected, setRemoteSelected] = useState(false);
  // Counts the moments the queue is likely to have changed, so the queue view re-reads it.
  const [queueVersion, setQueueVersion] = useState(0);
  const playbackRequestRef = useRef(0);
  const expectedPlayingRef = useRef<{ playing: boolean; until: number } | null>(null);
  const playPauseInFlightRef = useRef(false);
  // The Web Playback SDK player this page runs ("THE MAX MIX"), once it is connected.
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const sdkActiveRef = useRef(false);
  const lastTrackIdRef = useRef<string | null>(null);
  const lastNextTracksRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  // Brings the SDK player back in step after the page was in the background (set while the player exists).
  const resumeRef = useRef<(() => void) | null>(null);

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
    const state = await spotify.getPlaybackState();
    if (requestId !== playbackRequestRef.current) return;
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
  }, [setPlayback]);

  // Reads playback from Spotify: at once, then every 4 s while another device plays (or in demo mode), and only as a
  // slow safety net while this page's SDK player is active and tells us about every change itself.
  const sdkDriven = sdkActive && !remoteSelected;
  useEffect(() => {
    if (!isDemoMode && !isAuthenticated) return;
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
        const apiError = error as ApiError;
        setConnectionError(apiError.message);
        if (apiError.status === 401 && !isSignedIn()) {
          setIsAuthenticated(false);
          setPlayback(null);
        }
        delay = Math.max(Math.min(60_000, base * 2 ** ++failures), (apiError.retryAfter ?? 0) * 1000 || 0);
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
  }, [isDemoMode, isAuthenticated, sdkDriven, refreshPlayback, invalidatePlayback, setPlayback]);

  // A background tab's timers are throttled to about one a minute and its connections can drop, so when the page comes
  // back to the front it reads everything again at once instead of waiting for the next (late) timer.
  useEffect(() => {
    if (!isDemoMode && !isAuthenticated) return;
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
  }, [isDemoMode, isAuthenticated, refreshPlayback, bumpQueue]);

  useEffect(() => {
    if (!isAuthenticated || isDemoMode || playbackMode !== 'browser') return;
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

    const initialize = async () => {
      try {
        const sdk = await loadSpotifySDK();
        if (isCancelled()) return;
        player = new sdk.Player({
          name: 'THE MAX MIX',
          getOAuthToken: callback => {
            getAccessToken()
              .then(token => {
                if (token) callback(token);
                else if (!isCancelled()) setSdkError('Spotify login expired. Sign in again in Settings.');
              })
              .catch((error: unknown) => {
                if (!isCancelled()) setSdkError((error as Error).message);
              });
          },
          volume: 0.8
        });
        // The SDK reports every change at once, which the Web API's state endpoint only does a second or so later.
        player.addListener('player_state_changed', applySdkState);
        player.addListener('ready', ({ device_id }: { device_id: string }) => {
          if (isCancelled()) return;
          deviceIdRef.current = device_id;
          setBrowserDeviceId(device_id);
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
          deviceIdRef.current = null;
          setBrowserDeviceId(null);
          markSdkActive(false);
          setSdkError('The tablet player disconnected. Check the connection or select another speaker.');
        });
        player.addListener('autoplay_failed', () => {
          if (!isCancelled()) setSdkError('The browser blocked autoplay. Tap Play on the screen to start the music.');
        });
        for (const event of ['initialization_error', 'authentication_error', 'account_error', 'playback_error']) {
          player.addListener(event, ({ message }: { message: string }) => {
            if (!isCancelled()) {
              setSdkError(
                `Browser playback: ${message} Remote playback mode is available if this Pi cannot stream audio.`
              );
            }
          });
        }
        const connected = await player.connect();
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
        else if (!isCancelled()) setSdkError('Could not connect the tablet player to Spotify.');
      } catch (error) {
        if (!isCancelled()) setSdkError((error as Error).message);
      }
    };
    void initialize();
    return () => {
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
    };
  }, [isAuthenticated, isDemoMode, playbackMode, holdPlaying, refreshPlayback, setPlayback, markSdkActive, bumpQueue]);

  const runCommand = useCallback(
    async (command: () => Promise<unknown>) => {
      try {
        await command();
        await refreshPlayback();
        setActionError(null);
        return true;
      } catch (error) {
        setActionError((error as Error).message);
        return false;
      }
    },
    [refreshPlayback]
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
      setActionError((error as Error).message);
      // The player may have dropped; reconnect it and read where it really is.
      resumeRef.current?.();
      return false;
    }
  };

  /** Moves playback to a device through the Web API and brings the state up to date. */
  const transferTo = useCallback(
    async (deviceId: string, play: boolean) => {
      await spotify.transferPlayback(deviceId, play);
      const toThisPage = deviceId === browserDeviceId;
      setRemoteSelected(!toThisPage);
      // This page's player is now the active device: later presses use the SDK, not another transfer.
      if (toThisPage) markSdkActive(true);
      await refreshPlayback();
      bumpQueue();
      setActionError(null);
    },
    [browserDeviceId, markSdkActive, refreshPlayback, bumpQueue]
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
          setActionError((error as Error).message);
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
      setActionError((error as Error).message);
      throw error;
    }
  };

  return {
    playbackState,
    browserDeviceId,
    isAuthenticated,
    isDemoMode,
    isConfigured,
    playbackMode,
    isLoading: (isDemoMode || isAuthenticated) && !loaded,
    isReady: Boolean(playbackState?.device),
    sdkActive: sdkDriven,
    queueVersion,
    error: actionError || connectionError || sdkError,
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
    refreshPlayback
  };
}
