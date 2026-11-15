// Where countdown-server is: its origin comes from the build's environment (.env.development, .env.production), so a
// build for countdown.run needs no code change. The registration page and the config route hang off it.

/** countdown-server's origin, or null when the build names none (or names something that is not an https origin). */
export function countdownServer(): string | null {
  const configured = import.meta.env.VITE_COUNTDOWN_SERVER?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}
