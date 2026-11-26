// Reads the text of a Wi-Fi QR code, the kind a phone shows to share its network (WIFI:T:WPA;S:name;P:password;;),
// so the kiosk can join the network held up to its camera. pi/kiosk-audio/qr.ts writes the same format for the hotspot.

/** The network a Wi-Fi QR code names. `unsupported` is one the kiosk cannot join (WEP, or a company sign-in). */
export interface WifiQr {
  ssid: string;
  password: string;
  hidden: boolean;
  security: 'open' | 'psk' | 'unsupported';
}

const PREFIX = 'WIFI:';

/** The fields of the code, by their letter. A backslash keeps the character after it as it is. */
function fields(body: string): Map<string, string> {
  const found = new Map<string, string>();
  let key: string | null = null;
  let part = '';
  for (let index = 0; index < body.length; index++) {
    const character = body.charAt(index);
    if (character === '\\' && index + 1 < body.length) {
      part += body.charAt(++index);
    } else if (character === ':' && key === null) {
      key = part.toUpperCase();
      part = '';
    } else if (character === ';') {
      if (key !== null && !found.has(key)) found.set(key, part);
      key = null;
      part = '';
    } else {
      part += character;
    }
  }
  // A code without its closing semicolons still counts.
  if (key !== null && !found.has(key)) found.set(key, part);
  return found;
}

/** A name or password some phones wrap in double quotes, without them. */
function unquoted(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function securityOf(type: string, password: string): WifiQr['security'] {
  const kind = type.toUpperCase();
  if (kind === '' || kind === 'NOPASS') return password === '' ? 'open' : 'psk';
  // WPA, WPA2, WPA3 and SAE are all a network with a password; WEP and WPA2-EAP are not ones the kiosk joins.
  if (kind === 'SAE' || (kind.startsWith('WPA') && !kind.includes('EAP'))) return 'psk';
  return 'unsupported';
}

/** The network in a QR code's text, or null when it is not a Wi-Fi code or names no network. */
export function parseWifiQr(text: string): WifiQr | null {
  const trimmed = text.trim();
  if (trimmed.slice(0, PREFIX.length).toUpperCase() !== PREFIX) return null;
  const found = fields(trimmed.slice(PREFIX.length));
  const ssid = unquoted(found.get('S') ?? '');
  if (ssid === '') return null;
  const password = unquoted(found.get('P') ?? '');
  return {
    ssid,
    password,
    hidden: (found.get('H') ?? '').toLowerCase() === 'true',
    security: securityOf(found.get('T') ?? '', password)
  };
}
