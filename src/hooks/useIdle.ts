import { useEffect, useRef, useState } from 'react';

// Input that counts as someone using the screen. Capture phase, so nothing in the page can hide it.
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const;

/** How long the kiosk waits, untouched with nothing playing, before it switches to the Dashboard. */
export const IDLE_DASHBOARD_MS = 2 * 60_000;

/**
 * Calls `onIdle` once nobody has touched the screen for `idleMs` while `busy` (music playing) is false. A touch, or
 * `busy` turning true, starts the countdown again. Does nothing when not `enabled`.
 */
export function useIdle({
  enabled,
  busy,
  idleMs,
  onIdle
}: Readonly<{ enabled: boolean; busy: boolean; idleMs: number; onIdle: () => void }>) {
  const onIdleRef = useRef(onIdle);
  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);
  // Bumped by every touch, which starts the countdown again.
  const [activity, setActivity] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const onActivity = () => setActivity(count => count + 1);
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, { capture: true, passive: true });
    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, { capture: true });
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || busy) return;
    const timer = setTimeout(() => onIdleRef.current(), idleMs);
    return () => clearTimeout(timer);
  }, [enabled, busy, idleMs, activity]);
}
