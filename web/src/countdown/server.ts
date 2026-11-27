// Where countdown-server is. It answers on two names, and the build's environment (.env.development, .env.production)
// names both, so a build for countdown.run needs no code change:
// - the settings site (VITE_COUNTDOWN_SERVER), all behind the owner's sign-in: the kiosk's pairing QR code opens its
//   /pair/add page on the owner's phone;
// - the screens' API (VITE_COUNTDOWN_API), with no sign-in but the device secret: the kiosk's registration, its config
//   and its saves.
//   The settings site's sign-in stands in front of anything else there, so the API's calls never reach it.

/** The value as an https origin, or null when it is missing or not one. */
function httpsOrigin(configured: string | undefined): string | null {
  const value = configured?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** The settings site's origin, or null when the build names none (or names something that is not an https origin). */
export function countdownServer(): string | null {
  return httpsOrigin(import.meta.env.VITE_COUNTDOWN_SERVER);
}

/** The screens' API's origin, or null when the build names none (or names something that is not an https origin). */
export function countdownApi(): string | null {
  return httpsOrigin(import.meta.env.VITE_COUNTDOWN_API);
}
