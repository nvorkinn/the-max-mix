import { useCallback, useEffect, useState } from 'react';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';
import { wakeDisplay } from '../utils/screenSleep';

// Input that counts as someone using the screen. Capture phase, so nothing in the page can hide it.
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const;

/** How long the Dashboard shows untouched before it dims. */
export const DIM_AFTER_MS = 5 * 60_000;
/** How long the screen stays on untouched during quiet hours, on any tab. */
export const QUIET_SLEEP_MS = 60_000;
/** How long a screen with a backlight stays bright untouched during quiet hours, before it dims for the rest of that minute. */
export const QUIET_DIM_MS = 10_000;

const START_ASLEEP_KEY = 'maxmix.startAsleep';

/** Has the next page load start with the screen asleep, as after switching person while nobody watched. */
export function startNextAsleep(): void {
  try {
    sessionStorage.setItem(START_ASLEEP_KEY, '1');
  } catch {
    // Without storage the page starts awake and dims and sleeps again as usual.
  }
}

function takeStartAsleep(): boolean {
  try {
    const isSet = sessionStorage.getItem(START_ASLEEP_KEY) === '1';
    sessionStorage.removeItem(START_ASLEEP_KEY);
    return isSet;
  } catch {
    return false;
  }
}

/**
 * The kiosk's screen sleep (see utils/screenSleep). With nothing playing, the Dashboard dims once nobody has touched the
 * screen for DIM_AFTER_MS, and sleeps `sleepMs` after that (null: it stays dimmed). During `quiet` hours the screen
 * sleeps QUIET_SLEEP_MS after the last touch instead, on any tab; a `backlit` screen (one whose backlight the Pi can turn
 * down) dims QUIET_DIM_MS after the touch on the way there, so it is not left bright for the whole minute. Music
 * playing keeps the screen on and bright.
 * Dimmed and asleep both last until `wake` is called, so the tap that wakes the screen never reaches the page behind the
 * overlay. Music starting brings the screen back by itself. While not asleep the page holds a screen wake lock. Does
 * nothing when not `enabled` (not on the kiosk).
 */
export function useScreenSleep({
  enabled,
  keepAwake,
  onDashboard,
  sleepMs,
  quiet,
  backlit = false
}: Readonly<{
  enabled: boolean;
  keepAwake: boolean;
  onDashboard: boolean;
  sleepMs: number | null;
  quiet: boolean;
  backlit?: boolean;
}>) {
  const [phase, setPhase] = useState<'awake' | 'dimmed' | 'asleep'>(() =>
    enabled && takeStartAsleep() ? 'asleep' : 'awake'
  );
  const asleep = phase === 'asleep';
  const [lockHeld, setLockHeld] = useState(false);
  // Bumped by every touch and by wake(), which starts the countdown again.
  const [activity, setActivity] = useState(0);

  const wake = useCallback(() => {
    setPhase('awake');
    setActivity(count => count + 1);
  }, []);

  // Any input while awake starts the countdown again. A key press also wakes: there is no overlay to tap with a
  // keyboard, and a key cannot press a button by accident the way a tap can.
  useEffect(() => {
    if (!enabled) return;
    const onActivity = (event: Event) => {
      if (phase === 'awake' || event.type === 'keydown') wake();
    };
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, { capture: true, passive: true });
    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, { capture: true });
    };
  }, [enabled, phase, wake]);

  // The countdown to the next step, from the last touch or from the moment the music stopped, the Dashboard came up or
  // quiet hours began. In quiet hours the Dashboard coming up does not start it again: it comes up by itself a minute
  // after the last touch, just as the screen is due to sleep.
  const dashboardShown = quiet ? null : onDashboard;
  useEffect(() => {
    if (!enabled || keepAwake || phase === 'asleep') return;
    let delay: number;
    let next: 'dimmed' | 'asleep';
    let reason: string;
    if (quiet && backlit && phase === 'awake') {
      [delay, next, reason] = [QUIET_DIM_MS, 'dimmed', 'Quiet hours: the screen dims'];
    } else if (quiet) {
      // Dimmed already, a backlit screen sleeps after the rest of the minute.
      const delayMs = backlit && phase === 'dimmed' ? QUIET_SLEEP_MS - QUIET_DIM_MS : QUIET_SLEEP_MS;
      [delay, next, reason] = [delayMs, 'asleep', 'Quiet hours: the screen sleeps'];
    } else if (!dashboardShown) {
      return;
    } else if (phase === 'awake') {
      [delay, next, reason] = [DIM_AFTER_MS, 'dimmed', 'Dashboard idle: the screen dims'];
    } else if (sleepMs === null) {
      return;
    } else {
      [delay, next, reason] = [sleepMs, 'asleep', 'Idle with nothing playing: the screen sleeps'];
    }
    const timer = setTimeout(() => {
      debugLog('info', 'screen', reason);
      setPhase(next);
    }, delay);
    return () => clearTimeout(timer);
  }, [enabled, keepAwake, phase, quiet, backlit, dashboardShown, sleepMs, activity]);

  // Music that starts while the screen is dimmed or asleep (from a phone, say) brings it back. Only a touch turns the
  // Pi's output on by itself, so the app asks for it after sleep.
  const [wokenForMusic, setWokenForMusic] = useState(false);
  if (enabled && phase === 'dimmed' && keepAwake) {
    setPhase('awake');
  } else if (enabled && asleep && keepAwake && !wokenForMusic) {
    setWokenForMusic(true);
    setPhase('awake');
  } else if (wokenForMusic && !keepAwake) {
    setWokenForMusic(false);
  }
  useEffect(() => {
    if (wokenForMusic) {
      debugLog('info', 'screen', 'Music started: the screen wakes');
      wakeDisplay();
    }
  }, [wokenForMusic]);

  // The wake lock, held while not asleep (dimmed too). The browser drops it whenever the page is hidden, so it is asked for again on return.
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  useEffect(() => {
    if (!enabled || !supported || asleep) return;
    let cancelled = false;
    let sentinel: WakeLockSentinel | null = null;
    const listeners = new AbortController();
    const onRelease = () => setLockHeld(false);
    const request = async () => {
      if (document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          void lock.release();
          return;
        }
        sentinel = lock;
        setLockHeld(true);
        lock.addEventListener('release', onRelease, { signal: listeners.signal });
      } catch (caught) {
        debugLog('error', 'screen', `Could not keep the screen on: ${errorMessage(caught)}`);
      }
    };
    const onVisibility = () => void request();
    void request();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      listeners.abort();
      void sentinel?.release();
      setLockHeld(false);
    };
  }, [enabled, supported, asleep]);

  // held: the screen is kept on. released: the Pi may turn it off. unsupported: the browser has no wake lock.
  let wakeLock: 'held' | 'released' | 'unsupported' = lockHeld ? 'held' : 'released';
  if (!supported) wakeLock = 'unsupported';
  return { asleep, dimmed: phase === 'dimmed', wake, wakeLock };
}
