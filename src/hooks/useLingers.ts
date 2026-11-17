import { useEffect, useState } from 'react';

/** How long Dynamic keeps the album art's colours after the music stops, before it fades back to the chosen colour. */
export const DYNAMIC_LINGER_MS = 30_000;

/**
 * True while `on` is, and for `lingerMs` after it turns off, so a pause between songs or a quick skip doesn't flick what
 * follows it back and forth.
 */
export function useLingers(on: boolean, lingerMs: number): boolean {
  // Whether the linger since `on` last turned off has run out; it starts over each time `on` changes.
  const [runOut, setRunOut] = useState(!on);
  const [lastOn, setLastOn] = useState(on);
  if (on !== lastOn) {
    setLastOn(on);
    setRunOut(false);
  }
  useEffect(() => {
    if (on) return;
    const timer = setTimeout(() => setRunOut(true), lingerMs);
    return () => clearTimeout(timer);
  }, [on, lingerMs]);
  return on || !runOut;
}
