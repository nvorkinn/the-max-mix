// QR codes for the hotspot setup: the Wi-Fi code a phone's camera joins the network with, and the code for the page's
// address. Made here, on the Pi, because the setup page has to work with no internet. qrcode-generator is loaded only
// when a code is made, so a Pi where it is missing loses the hotspot button and nothing else.

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

/** A QR code as rows of `0` and `1` (a dark module is `1`), for the page to draw. */
export async function qrRows(text: string): Promise<string[]> {
  const { default: qrcode } = await import('qrcode-generator');
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_unused, column) => (code.isDark(row, column) ? '1' : '0')).join('')
  );
}
