// The text of a Wi-Fi QR code, which the Pi's server writes for its setup hotspot (server/src/hotspot.ts) and the app
// writes for sharing the kiosk's network. Both import this file, so it imports nothing.

// What the Wi-Fi QR format escapes with a backslash.
const SPECIAL = new Set(['\\', ';', ',', ':', '"']);

function escapeSpecial(value: string): string {
  let escaped = '';
  for (const character of value) escaped += SPECIAL.has(character) ? `\\${character}` : character;
  return escaped;
}

/** The text of a QR code that makes a phone join a WPA network (the Wi-Fi format its camera understands). */
export function wifiQrText(ssid: string, password: string): string {
  return `WIFI:T:WPA;S:${escapeSpecial(ssid)};P:${escapeSpecial(password)};;`;
}
