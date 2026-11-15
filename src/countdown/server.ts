// Where countdown-server is: its origin comes from the build's environment (.env.development, .env.production), so a
// build for countdown.run needs no code change. The registration page, the config route and the embedded settings site
// all hang off it.

import { deviceSettingsPageUrl } from '../../vendor/countdown-api/src/countdown_api/client';

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

/**
 * The config site's page for this device (its home page until the kiosk is registered) in the site's embedded mode, with
 * no frame of its own, to show inside the Settings tab; or null when the build names no server.
 */
export function configSiteUrl(deviceId: string | null): string | null {
  const server = countdownServer();
  if (!server) return null;
  // The device's page is the contract's (GET /device/{device_id}, whose embed=1 drops the site around it); the home page
  // isn't in it.
  if (deviceId) return deviceSettingsPageUrl(server, { device_id: deviceId }, { embed: '1' }).href;
  const url = new URL('/', server);
  url.searchParams.set('embed', '1');
  return url.href;
}
