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

/**
 * The kiosk's screen sleep (see utils/screenSleep). With nothing playing, the Dashboard dims once nobody has touched the
 * screen for DIM_AFTER_MS, and sleeps `sleepMs` after that (null: it stays dimmed). During `quiet` hours the screen
 * sleeps QUIET_SLEEP_MS after the last touch instead, on any tab. Music playing keeps the screen on and bright.
 * Dimmed and asleep both last until `wake` is called, so the tap that wakes the screen never reaches the page behind the
 * overlay. Music starting brings the screen back by itself. While not asleep the page holds a screen wake lock. Does
 * nothing when not `enabled` (not on the kiosk). `sleepNow` sleeps at once, music or not, and music then does not wake
 * the screen: only a touch does.
 */
export function useScreenSleep({
  enabled,
  keepAwake,
  onDashboard,
  sleepMs,
  quiet
}: Readonly<{ enabled: boolean; keepAwake: boolean; onDashboard: boolean; sleepMs: number | null; quiet: boolean }>) {
  const [phase, setPhase] = useState<'awake' | 'dimmed' | 'asleep'>('awake');
  const asleep = phase === 'asleep';
  const [lockHeld, setLockHeld] = useState(false);
  // Set by the sleep button: a screen put to sleep on purpose stays that way while music plays.
  const [forced, setForced] = useState(false);
  // Bumped by every touch and by wake(), which starts the countdown again.
  const [activity, setActivity] = useState(0);

  const wake = useCallback(() => {
    setPhase('awake');
    setForced(false);
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

  const sleepNow = useCallback(() => {
    debugLog('info', 'screen', 'Sleep button: the screen sleeps');
    setForced(true);
    setPhase('asleep');
  }, []);

  // The countdown to the next step, from the last touch or from the moment the music stopped, the Dashboard came up or
  // quiet hours began.
  useEffect(() => {
    if (!enabled || keepAwake || phase === 'asleep') return;
    let delay: number;
    let next: 'dimmed' | 'asleep';
    let reason: string;
    if (quiet) {
      [delay, next, reason] = [QUIET_SLEEP_MS, 'asleep', 'Quiet hours: the screen sleeps'];
    } else if (!onDashboard) {
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
  }, [enabled, keepAwake, phase, quiet, onDashboard, sleepMs, activity]);

  // Music that starts while the screen is dimmed or asleep (from a phone, say) brings it back. Only a touch turns the
  // Pi's output on by itself, so the app asks for it after sleep.
  const [wokenForMusic, setWokenForMusic] = useState(false);
  if (enabled && phase === 'dimmed' && keepAwake) {
    setPhase('awake');
  } else if (enabled && asleep && !forced && keepAwake && !wokenForMusic) {
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
  return { asleep, dimmed: phase === 'dimmed', wake, sleepNow, wakeLock };
}
