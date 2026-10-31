import { useCallback, useEffect, useState } from 'react';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';
import { wakeDisplay } from '../utils/screenSleep';

// Input that counts as someone using the screen. Capture phase, so nothing in the page can hide it.
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const;

/**
 * The kiosk's screen sleep (see utils/screenSleep). `asleep` turns true once nobody has touched the screen for `idleMs`
 * while `keepAwake` (music playing) is false, and stays true until `wake` is called, so the tap that wakes the screen
 * never reaches the page behind the sleep screen. Music starting while asleep wakes the screen by itself. While awake
 * the page holds a screen wake lock; idleMs null holds it for good. Does nothing when not `enabled` (not on the kiosk).
 */
export function useScreenSleep({
  enabled,
  keepAwake,
  idleMs
}: Readonly<{ enabled: boolean; keepAwake: boolean; idleMs: number | null }>) {
  const [asleep, setAsleep] = useState(false);
  const [lockHeld, setLockHeld] = useState(false);
  // Bumped by every touch and by wake(), which starts the idle countdown again.
  const [activity, setActivity] = useState(0);

  const wake = useCallback(() => {
    setAsleep(false);
    setActivity(count => count + 1);
  }, []);

  // Any input while awake starts the countdown again. A key press also wakes: there is no sleep screen to tap with a
  // keyboard, and a key cannot press a button by accident the way a tap can.
  useEffect(() => {
    if (!enabled) return;
    const onActivity = (event: Event) => {
      if (!asleep || event.type === 'keydown') wake();
    };
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, { capture: true, passive: true });
    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, { capture: true });
    };
  }, [enabled, asleep, wake]);

  // The countdown, from the last touch or from the moment the music stopped.
  useEffect(() => {
    if (!enabled || asleep || keepAwake || idleMs === null) return;
    const timer = setTimeout(() => {
      debugLog('info', 'screen', 'Idle with nothing playing: the screen sleeps');
      setAsleep(true);
    }, idleMs);
    return () => clearTimeout(timer);
  }, [enabled, asleep, keepAwake, idleMs, activity]);

  // Music that starts while the screen sleeps (from a phone, say) brings it back. Only a touch turns the Pi's output on
  // by itself, so the app asks for it.
  const [wokenForMusic, setWokenForMusic] = useState(false);
  if (enabled && asleep && keepAwake && !wokenForMusic) {
    setWokenForMusic(true);
    setAsleep(false);
  } else if (wokenForMusic && !keepAwake) {
    setWokenForMusic(false);
  }
  useEffect(() => {
    if (wokenForMusic) {
      debugLog('info', 'screen', 'Music started: the screen wakes');
      wakeDisplay();
    }
  }, [wokenForMusic]);

  // The wake lock, held while awake. The browser drops it whenever the page is hidden, so it is asked for again on return.
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
  return { asleep, wake, wakeLock };
}
