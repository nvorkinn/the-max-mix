import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { MusicChoice, PlaybackState, RepeatMode, SpotifyDevice, Track } from '../types';
import * as spotify from '../spotify/api';
import { lastSoloistState } from '../countdown/soloist';
import { isSignedIn } from '../spotify/auth';
import {
  checkSpotifyRetryWindow,
  getSpotifyRetryDelay,
  isSpotifyQuotaExceeded,
  NETWORK_ERROR_MESSAGE,
  recordSpotifyRetryAfter,
  SpotifyApiError
} from '../spotify/http';
import { getPlaybackMode } from '../spotify/settings';
import { SoloistPlayer } from '../spotify/soloistPlayer';
import type { KioskPlaybackState } from '../spotify/soloistPlayer';
import { errorMessage } from '../utils/errorMessage';
import { debugLog } from '../utils/debugLog';
import { useSpotifyPolling } from './useSpotifyPolling';

// Spotify's playback state lags a play/pause command by a second or more, so a read right after one still reports the
// old state. For this long after a command the button keeps the state the command asked for.
const EXPECTED_PLAYING_MS = 5000;
// The same for the device: right after playback is started on, or moved to, the kiosk's player, a read still names the
// device that played before. For this long the page keeps showing the kiosk as the device (and reads again once to check).
const EXPECTED_DEVICE_MS = 8000;
// The name the Pi's service gives Spotify Soloist (pi/kiosk-audio/soloist.ts).
const KIOSK_DEVICE_NAME = 'The Max Mix Soloist';
const DEVICE_CHECK_MS = 3000;
// The same for shuffle and repeat: a tap shows its result at once and keeps it this long against reads that predate it.
const EXPECTED_SETTING_MS = 5000;
// While another device plays the kiosk's player reports nothing, so the state is read this often.
const REMOTE_POLL_MS = 4000;
// While the kiosk's screen sleeps nobody is watching, so the state is read this seldom: a sleeping tablet that kept
// polling every 4 s used up Spotify's rate limit for everyone else on the account. Music started elsewhere wakes it late.
const ASLEEP_POLL_MS = 45_000;
// While the kiosk's player is the active device its events carry the changes; this is only a safety net.
const PLAYER_POLL_MS = 30_000;
// Soloist starts with the page (countdown/soloist.ts) and signs in; a player that has not come up by then is reported,
// and keeps trying.
const PLAYER_START_MS = 20_000;
// Soloist reports itself signed out for a moment while it restores a session; asking for a pick waits this long first.
const SIGN_IN_GRACE_MS = 5000;
// Spotify can take a moment to answer for a player it has just listed again; one more try waits this.
const REREGISTER_RETRY_MS = 1500;
const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: 'context', context: 'track', track: 'off' };

type PlaybackOrNull = PlaybackState | null;

export interface PlaybackProblem {
  message: string;
  recovery:
    | 'sign-in'
    | 'choose-speaker'
    | 'settings'
    | 'soloist-key'
    | 'pick-on-phone'
    | 'reconnect'
    | 'refresh'
    | 'wait'
    | 'quota';
}

/** Spotify's answer when it does not know the device a command named. */
const isDeviceUnknown = (error: unknown) => error instanceof SpotifyApiError && error.status === 404;

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
  /** Whether the kiosk's own player is the active device, and so reports every change itself. */
  isPlayerActive: boolean;
  queueVersion: number;
  /**
   * Every song coming up, as the kiosk's player (Soloist) lists it, while it is the active device and has a list to show;
   * null otherwise, when the queue is read from the Web API.
   */
  kioskQueue: Track[] | null;
  error: string | null;
  problem: PlaybackProblem | null;
  clearError: () => void;
  togglePlay: () => Promise<boolean>;
  nextTrack: () => Promise<boolean>;
  /** Skips forward this many songs, one after the other, stopping at the first that fails. */
  skipAhead: (steps: number) => Promise<boolean>;
  previousTrack: () => Promise<boolean>;
  seek: (position: number) => Promise<boolean>;
  setVolume: (volume: number) => Promise<boolean>;
  toggleShuffle: () => Promise<boolean>;
  cycleRepeat: () => Promise<boolean>;
  transferPlayback: (deviceId: string) => Promise<boolean>;
  /** Playback was moved off the kiosk outside Spotify Connect (a Sonos started the song itself): follow it remotely. */
  handOff: () => Promise<void>;
  /** Starts a playlist, Liked Songs or a track: on the device that is playing, otherwise on the kiosk's player. */
  playMusic: (choice: MusicChoice) => Promise<boolean>;
  refreshPlayback: () => Promise<void>;
  /** Reads playback seldom (instead of every 4 s) while another device plays and nobody is watching the screen. */
  setSlowPolling: (slow: boolean) => void;
  retryPlayback: () => Promise<boolean>;
  reconnectPlayer: () => void;
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
 * paused, so after the flag is changed here (by a press or a player event) those two are out of date and are dropped;
 * left in, they would keep the Play button disabled until the next read from Spotify.
 */
function withPlaying(state: PlaybackState, playing: boolean): PlaybackState {
  const disallows = Object.fromEntries(
    Object.entries(state.actions?.disallows ?? {}).filter(([action]) => action !== 'pausing' && action !== 'resuming')
  );
  return { ...state, is_playing: playing, actions: { ...state.actions, disallows } };
}

export function useSpotifyPlayer(): UseSpotifyPlayer {
  // Settings change only through a reload, so they are read once.
  const [playbackMode] = useState(getPlaybackMode);
  const [isAuthenticated, setIsAuthenticated] = useState(isSignedIn);
  const [snapshot, setSnapshot] = useState<{ state: PlaybackOrNull; at: number }>({ state: null, at: 0 });
  const [now, setNow] = useState(Date.now);
  const [loaded, setLoaded] = useState(false);
  const [browserDeviceId, setBrowserDeviceId] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<PlaybackProblem | null>(null);
  const [actionError, setActionError] = useState<PlaybackProblem | null>(null);
  const [playerError, setPlayerError] = useState<PlaybackProblem | null>(null);
  const [connectionVersion, setConnectionVersion] = useState(0);
  // True while the kiosk's player reports itself as the active device (it reports null once another device takes over).
  const [playerActive, setPlayerActive] = useState(false);
  const [slowPolling, setSlowPolling] = useState(false);
  const { enabled: pollEnabled, quotaExceeded } = useSpotifyPolling();
  // True once a different device was picked under Speakers: play/pause then go to that device through the Web API.
  const [remoteSelected, setRemoteSelected] = useState(false);
  // Counts the moments the queue is likely to have changed, so the queue view re-reads it.
  const [queueVersion, setQueueVersion] = useState(0);
  // The queue as the kiosk's player last listed it (see kioskQueue).
  const [playerQueue, setPlayerQueue] = useState<Track[] | null>(null);
  const playbackRequestRef = useRef(0);
  const expectedPlayingRef = useRef<{ playing: boolean; until: number } | null>(null);
  const expectedDeviceRef = useRef<{ device: SpotifyDevice; until: number } | null>(null);
  const deviceCheckRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const playPauseInFlightRef = useRef(false);
  // The kiosk's own player (Spotify Soloist on the Pi), while the page is in browser mode.
  const playerRef = useRef<SoloistPlayer | null>(null);
  const lastTrackIdRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);

  const problemForApi = useCallback((error: unknown) => {
    if (error instanceof SpotifyApiError) recordSpotifyRetryAfter(error);
    return apiProblem(error);
  }, []);
  const checkRetryWindow = checkSpotifyRetryWindow;

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

  // The shuffle and repeat a tap asked for, held against reads that predate it until Spotify agrees or the hold runs out.
  const expectedSettingsRef = useRef<{
    shuffle?: { on: boolean; until: number } | undefined;
    repeat?: { mode: RepeatMode; until: number } | undefined;
  }>({});
  const heldShuffle = useCallback((reported: boolean) => {
    const held = expectedSettingsRef.current.shuffle;
    if (!held) return reported;
    if (reported === held.on || Date.now() > held.until) {
      expectedSettingsRef.current = { ...expectedSettingsRef.current, shuffle: undefined };
      return reported;
    }
    return held.on;
  }, []);
  const heldRepeat = useCallback((reported: RepeatMode) => {
    const held = expectedSettingsRef.current.repeat;
    if (!held) return reported;
    if (reported === held.mode || Date.now() > held.until) {
      expectedSettingsRef.current = { ...expectedSettingsRef.current, repeat: undefined };
      return reported;
    }
    return held.mode;
  }, []);

  // The device a read should show: while playback is settling onto the kiosk's player, a read that still names the
  // previous device is shown as the kiosk instead. Spotify agreeing, or the window passing, ends the hold.
  const heldDevice = useCallback((state: PlaybackOrNull): PlaybackOrNull => {
    const held = expectedDeviceRef.current;
    if (!held || !state) return state;
    if (state.device?.id === held.device.id || Date.now() > held.until) {
      expectedDeviceRef.current = null;
      return state;
    }
    return { ...state, device: held.device };
  }, []);

  const refreshPlayback = useCallback(async () => {
    const requestId = ++playbackRequestRef.current;
    checkRetryWindow();
    const read = await spotify.getPlaybackState();
    if (requestId !== playbackRequestRef.current) return;
    const state = heldDevice(
      read && {
        ...read,
        ...(read.shuffle_state !== undefined && { shuffle_state: heldShuffle(read.shuffle_state) }),
        ...(read.repeat_state !== undefined && { repeat_state: heldRepeat(read.repeat_state) })
      }
    );
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
  }, [setPlayback, checkRetryWindow, heldShuffle, heldRepeat, heldDevice]);

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
  // net while the kiosk's player is active and tells us about every change itself.
  // Not while Spotify says another device plays (another device took over, or the kiosk's player has not yet): the
  // events then cannot be trusted to carry the changes, so the state is read every few seconds until it agrees.
  const readDeviceId = snapshot.state?.device?.id;
  const playerDriven =
    playerActive && !remoteSelected && (!readDeviceId || !browserDeviceId || readDeviceId === browserDeviceId);
  useEffect(() => {
    // Once Spotify's quota is used up nothing reads it again until the app is restarted.
    if (!isAuthenticated || quotaExceeded) return;
    let cancelled = false;
    // Read through a function: TypeScript narrows the flag to `false` and cannot see the cleanup flip it mid-await.
    const isCancelled = () => cancelled;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const poll = async () => {
      let base = REMOTE_POLL_MS;
      if (playerDriven) base = PLAYER_POLL_MS;
      else if (slowPolling) base = ASLEEP_POLL_MS;
      let delay = base;
      try {
        await refreshPlayback();
        if (isCancelled()) return;
        setConnectionError(null);
        failures = 0;
      } catch (error) {
        if (isCancelled()) return;
        reportConnectionError(error);
        delay = Math.max(Math.min(60_000, base * 2 ** ++failures), getSpotifyRetryDelay());
      }
      setLoaded(true);
      // With polling turned off in the settings this was the one read; the next comes from a button press or a return to the page.
      if (pollEnabled && !isCancelled() && !isSpotifyQuotaExceeded()) timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => {
      cancelled = true;
      invalidatePlayback();
      clearTimeout(timer);
    };
  }, [
    isAuthenticated,
    quotaExceeded,
    pollEnabled,
    playerDriven,
    slowPolling,
    refreshPlayback,
    invalidatePlayback,
    reportConnectionError
  ]);

  // A background tab's timers are throttled to about one a minute and its connections can drop, so when the page comes
  // back to the front it reads everything again at once instead of waiting for the next (late) timer.
  useEffect(() => {
    if (!isAuthenticated || quotaExceeded) return;
    const wake = () => {
      if (document.visibilityState === 'hidden') return;
      refreshPlayback().catch(() => {});
      bumpQueue();
      playerRef.current?.refresh();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
    };
  }, [isAuthenticated, quotaExceeded, refreshPlayback, bumpQueue]);

  // The kiosk's own player: Spotify Soloist, which the Pi's service runs for the active person. Its events show every
  // change at once, which the Web API's state endpoint only does a second or so later.
  useEffect(() => {
    if (!isAuthenticated || playbackMode !== 'browser') return;
    const applyPlayerState = (state: KioskPlaybackState) => {
      setPlayerActive(Boolean(state));
      if (!state) {
        // Another device plays (or none): its queue comes from the Web API, and Soloist's list is stale by the time it
        // is the active device again.
        setPlayerQueue(null);
        return;
      }
      holdPlaying(!state.paused);
      const { track } = state;
      setPlayback(current => ({
        ...withPlaying(current ?? {}, !state.paused),
        progress_ms: state.position,
        ...(state.duration !== undefined && { duration: state.duration }),
        ...(state.shuffle !== undefined && { shuffle_state: heldShuffle(state.shuffle) }),
        ...(state.repeat && { repeat_state: heldRepeat(state.repeat) }),
        // The Web API's track has more detail than the player's, so it is only replaced when the track changed.
        ...(track && current?.item?.id !== track.id && { item: track })
      }));
      const trackId = track?.id ?? null;
      if (trackId !== lastTrackIdRef.current) {
        lastTrackIdRef.current = trackId;
        // The device and the rest of the details come from the Web API; read them now, not at the next safety poll.
        refreshPlayback().catch(() => {});
      }
    };

    let signInTimer: ReturnType<typeof setTimeout> | undefined;
    const startTimer = setTimeout(() => {
      setPlayerError(
        lastSoloistState() === 'no-key'
          ? { message: 'To play on the kiosk, add your Soloist key under Settings.', recovery: 'soloist-key' }
          : { message: 'The kiosk player did not start. Try reconnecting.', recovery: 'reconnect' }
      );
    }, PLAYER_START_MS);
    const player = new SoloistPlayer({
      onReady: deviceId => {
        clearTimeout(startTimer);
        clearTimeout(signInTimer);
        debugLog('info', 'soloist', `Kiosk player ready as device ${deviceId}`);
        deviceIdRef.current = deviceId;
        setBrowserDeviceId(deviceId);
        setPlayerError(null);
        refreshPlayback().catch(() => {});
        bumpQueue();
      },
      onNotReady: () => {
        debugLog('warn', 'soloist', 'Kiosk player went offline');
        deviceIdRef.current = null;
        setBrowserDeviceId(null);
        setPlayerError({
          message: 'The tablet player disconnected. Check the connection or select another speaker.',
          recovery: 'reconnect'
        });
      },
      onSignedOut: () => {
        clearTimeout(startTimer);
        clearTimeout(signInTimer);
        debugLog('info', 'soloist', 'Kiosk player waits to be signed in');
        // Soloist says it is signed out for a moment as it starts, before it restores the person's session, so neither
        // that nor the disconnect it causes is reported unless it lasts.
        setPlayerError(null);
        signInTimer = setTimeout(() => {
          setPlayerError({
            message: `To sign the kiosk in, pick ${KIOSK_DEVICE_NAME} in Spotify on your phone.`,
            recovery: 'pick-on-phone'
          });
        }, SIGN_IN_GRACE_MS);
      },
      onState: applyPlayerState,
      onQueue: upcoming => {
        setPlayerQueue(upcoming);
        // Without Soloist's list, the queue view reads the Web API's.
        if (!upcoming) bumpQueue();
      }
    });
    playerRef.current = player;
    debugLog('info', 'soloist', 'Connecting the kiosk player');
    player.connect();
    return () => {
      clearTimeout(startTimer);
      clearTimeout(signInTimer);
      player.disconnect();
      playerRef.current = null;
      deviceIdRef.current = null;
      lastTrackIdRef.current = null;
      setPlayerActive(false);
      setPlayerQueue(null);
      setBrowserDeviceId(null);
    };
  }, [
    isAuthenticated,
    playbackMode,
    holdPlaying,
    refreshPlayback,
    setPlayback,
    bumpQueue,
    heldShuffle,
    heldRepeat,
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

  // The kiosk's player is the one to drive unless another device was picked under Speakers. Soloist's commands act on
  // whichever device is active, so they only go to it while it reports itself active; otherwise commands go to the
  // active device through the Web API.
  const kioskPlayer = () => (remoteSelected ? null : playerRef.current);

  /** Runs a command on the kiosk's player; its state change arrives as an event. Null when the player is not active. */
  const runPlayerCommand = async (command: (player: SoloistPlayer) => Promise<void>) => {
    const player = kioskPlayer();
    if (!player?.isActive) return null;
    try {
      await command(player);
      setActionError(null);
      return true;
    } catch (error) {
      setActionError(problemForApi(error));
      // The player may have dropped; read where it really is.
      player.refresh();
      return false;
    }
  };

  useEffect(() => () => clearTimeout(deviceCheckRef.current), []);

  /**
   * Playback is being started on, or moved to, the kiosk's player: show it as the device until Spotify says so too
   * (its state lags by seconds and would name the previous device), and read once more shortly to check.
   */
  const holdThisDevice = useCallback(() => {
    const id = deviceIdRef.current ?? browserDeviceId;
    if (!id) return;
    const device: SpotifyDevice = { id, name: KIOSK_DEVICE_NAME, type: 'Speaker', is_active: true };
    expectedDeviceRef.current = { device, until: Date.now() + EXPECTED_DEVICE_MS };
    clearTimeout(deviceCheckRef.current);
    deviceCheckRef.current = setTimeout(() => {
      refreshPlayback().catch(() => {});
    }, DEVICE_CHECK_MS);
  }, [browserDeviceId, refreshPlayback]);
  const releaseDevice = useCallback(() => {
    expectedDeviceRef.current = null;
    clearTimeout(deviceCheckRef.current);
  }, []);

  /**
   * Spotify can answer 404 for the kiosk's player under the id it was listed with (Soloist started again, or Spotify
   * listed it anew). The player is looked up in Spotify's device list again, and this resolves with its id, or null
   * when Spotify does not list it.
   */
  const reregister = useCallback(async (): Promise<string | null> => {
    debugLog('warn', 'soloist', 'Spotify does not know the kiosk player under its id any more; looking it up again');
    return (await playerRef.current?.refreshDevice()) ?? null;
  }, []);

  /**
   * Runs a command that names the kiosk's player. When Spotify answers that it does not know the player, it is looked
   * up again and the command runs once more on its id (and once after a short wait, while Spotify catches up).
   */
  const onThisPlayer = useCallback(
    async <T>(deviceId: string, run: (id: string) => Promise<T>): Promise<T> => {
      try {
        return await run(deviceId);
      } catch (error) {
        if (!isDeviceUnknown(error)) throw error;
        const fresh = await reregister();
        if (!fresh) throw error;
        let result: T;
        try {
          result = await run(fresh);
        } catch (again) {
          if (!isDeviceUnknown(again)) throw again;
          await pause(REREGISTER_RETRY_MS);
          result = await run(fresh);
        }
        // The device shown while Spotify catches up is the player under its new id.
        holdThisDevice();
        return result;
      }
    },
    [reregister, holdThisDevice]
  );

  /** Moves playback to a device through the Web API and brings the state up to date. */
  const transferTo = useCallback(
    async (deviceId: string, play: boolean) => {
      checkRetryWindow();
      const toThisPage = deviceId === browserDeviceId;
      // Starting on the kiosk's player can raise its volume a step; it sets the volume it had again once it plays.
      if (toThisPage && play) playerRef.current?.expectStart();
      if (toThisPage) await onThisPlayer(deviceId, id => spotify.transferPlayback(id, play));
      else await spotify.transferPlayback(deviceId, play);
      setRemoteSelected(!toThisPage);
      // The kiosk's player is now the active device: later presses go to it, not into another transfer.
      if (toThisPage) {
        holdThisDevice();
        setPlayerActive(true);
      } else {
        releaseDevice();
      }
      await refreshPlayback();
      bumpQueue();
      setActionError(null);
    },
    [browserDeviceId, refreshPlayback, bumpQueue, checkRetryWindow, holdThisDevice, releaseDevice, onThisPlayer]
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
      const player = kioskPlayer();
      let ok: boolean;
      if (player?.isActive) {
        ok = (await runPlayerCommand(active => (playing ? active.play() : active.pause()))) === true;
      } else if (player && playing && browserDeviceId) {
        // Not the active device yet: the first Play makes the kiosk the player (on a press, so loading the page
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

  const transport = async (command: (player: SoloistPlayer) => Promise<void>, apiCommand: () => Promise<unknown>) =>
    (await runPlayerCommand(command)) ?? runCommand(apiCommand);

  /**
   * Sends a shuffle or repeat change. The button shows the new setting at once and keeps it against reads that predate
   * the change, until Spotify reports the same (or EXPECTED_SETTING_MS has passed); a change that fails puts it back.
   */
  const runSetting = async (apiCommand: () => Promise<unknown>, change: { shuffle?: boolean; repeat?: RepeatMode }) => {
    const before = { shuffle: playbackState?.shuffle_state, repeat: playbackState?.repeat_state };
    const until = Date.now() + EXPECTED_SETTING_MS;
    expectedSettingsRef.current = {
      ...expectedSettingsRef.current,
      ...(change.shuffle !== undefined && { shuffle: { on: change.shuffle, until } }),
      ...(change.repeat && { repeat: { mode: change.repeat, until } })
    };
    setPlayback(
      current =>
        current && {
          ...current,
          ...(change.shuffle !== undefined && { shuffle_state: change.shuffle }),
          ...(change.repeat && { repeat_state: change.repeat })
        }
    );
    try {
      checkRetryWindow();
      await apiCommand();
      setActionError(null);
      return true;
    } catch (error) {
      // Back to what it was, and no longer held.
      expectedSettingsRef.current = {
        ...expectedSettingsRef.current,
        ...(change.shuffle !== undefined && { shuffle: undefined }),
        ...(change.repeat && { repeat: undefined })
      };
      setPlayback(
        current =>
          current && {
            ...current,
            ...(change.shuffle !== undefined && before.shuffle !== undefined && { shuffle_state: before.shuffle }),
            ...(change.repeat && before.repeat && { repeat_state: before.repeat })
          }
      );
      setActionError(problemForApi(error));
      return false;
    }
  };

  const transferPlayback = async (deviceId: string) => {
    try {
      await transferTo(deviceId, false);
      return true;
    } catch (error) {
      setActionError(problemForApi(error));
      throw error;
    }
  };

  // The account now plays somewhere this page did not send it through Spotify (a Sonos playing the song itself). The
  // page stops treating the kiosk's player as the active one and follows playback through the Web API, as after moving
  // to a Connect speaker, so the kiosk going quiet is not reported as a problem.
  const handOff = async () => {
    setRemoteSelected(true);
    setPlayerActive(false);
    releaseDevice();
    expectedPlayingRef.current = null;
    setActionError(null);
    try {
      await refreshPlayback();
    } catch {
      // The regular reads pick it up.
    }
    bumpQueue();
  };

  const nextTrack = () =>
    transport(
      player => player.nextTrack(),
      () => spotify.next()
    );

  const playMusic = async (choice: MusicChoice) => {
    const activeId = playbackState?.device?.id ?? null;
    const deviceId = remoteSelected && activeId ? activeId : (browserDeviceId ?? activeId);
    const toThisPage = Boolean(deviceId) && deviceId === browserDeviceId;
    // Held before the command: the read that follows it already predates the change.
    if (toThisPage) holdThisDevice();
    else releaseDevice();
    const ok = await runCommand(() =>
      toThisPage && deviceId
        ? onThisPlayer(deviceId, id => spotify.playChoice(choice, id))
        : spotify.playChoice(choice, deviceId)
    );
    if (ok) {
      if (toThisPage) {
        setRemoteSelected(false);
        setPlayerActive(true);
      }
      bumpQueue();
    } else {
      releaseDevice();
    }
    return ok;
  };

  const problem = actionError ?? connectionError ?? playerError;
  // The kiosk's player is on its way until it is ready or has a problem to report.
  const isConnecting = isAuthenticated && playbackMode === 'browser' && !browserDeviceId && !playerError;
  return {
    playbackState,
    browserDeviceId,
    isAuthenticated,
    playbackMode,
    isLoading: isAuthenticated && !loaded,
    isConnecting,
    isReady: Boolean(playbackState?.device),
    isPlayerActive: playerDriven,
    queueVersion,
    kioskQueue: playerDriven ? playerQueue : null,
    error: problem?.message ?? null,
    problem,
    clearError: () => setActionError(null),
    togglePlay,
    nextTrack,
    skipAhead: async (steps: number) => {
      for (let step = 0; step < steps; step++) {
        // Each skip must land before the next, so the loop waits on every one.
        // eslint-disable-next-line no-await-in-loop
        if (!(await nextTrack())) return false;
      }
      return true;
    },
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
        player => player.setVolume(volume * 100),
        () => spotify.setVolume(Math.round(volume * 100))
      ),
    toggleShuffle: () => {
      const on = !playbackState?.shuffle_state;
      return runSetting(() => spotify.setShuffle(on), { shuffle: on });
    },
    cycleRepeat: () => {
      const mode = NEXT_REPEAT[playbackState?.repeat_state ?? 'off'];
      return runSetting(() => spotify.setRepeat(mode), { repeat: mode });
    },
    transferPlayback,
    handOff,
    playMusic,
    refreshPlayback,
    setSlowPolling,
    retryPlayback,
    reconnectPlayer: () => {
      setPlayerError(null);
      setConnectionVersion(version => version + 1);
    }
  };
}
