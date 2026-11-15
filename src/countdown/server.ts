// Where countdown-server is: its origin comes from the build's environment (.env.development, .env.production), so a
// build for countdown.run needs no code change. The registration page, the config route and the embedded settings site
// all hang off it.

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

// ASSUMPTION: the config site's page for one device. The site has no published route for it yet; this is the one place
// to change when it does.
const DEVICE_PAGE = '/devices/';

/**
 * The config site's page for this device (its home page until the kiosk is registered) in the site's embedded mode, with
 * no frame of its own, to show inside the Settings tab; or null when the build names no server.
 */
export function configSiteUrl(deviceId: string | null): string | null {
  const server = countdownServer();
  if (!server) return null;
  const url = new URL(deviceId ? DEVICE_PAGE + encodeURIComponent(deviceId) : '/', server);
  url.searchParams.set('embed', '1');
  return url.href;
}
