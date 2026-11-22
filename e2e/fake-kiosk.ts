import type { Page, Request } from '@playwright/test';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true'
};

/** What the Pi answers, with nothing found, for its Bluetooth speakers and Sonos rooms. */
const EMPTY_LISTS: Record<string, object | undefined> = {
  '/bluetooth/devices': { devices: [] },
  '/sonos/groups': { groups: [], ms: 0 }
};

/** A speaker output as the Pi lists it (pi/kiosk-audio/speakers.ts). */
interface FakeOutput {
  id: string;
  name: string;
  kind: 'airplay' | 'bluetooth';
  address?: string;
  volume: number | null;
  linked: boolean;
}

/** An AirPlay output with this name and volume. */
export const airPlayOutput = (name: string, volume: number | null = null): FakeOutput => ({
  id: `raop_sink.${name}.local.7000`,
  name,
  kind: 'airplay',
  volume,
  linked: false
});

/**
 * The Pi as the app sees it (pi/kiosk-audio/server.ts) on the kiosk: it lists these outputs, and a route request links
 * the sound to exactly the ones it names, as the real one reports afterwards. Sonos and Bluetooth find nothing. Returns
 * the route and volume requests the page sends, as they arrive.
 */
export async function fakeKioskOutputs(page: Page, outputs: FakeOutput[]) {
  const routes: string[][] = [];
  const volumes: { output: string; volume: number }[] = [];
  await page.route('https://api.github.com/**', route => route.fulfill({ status: 404 }));
  await page.route('http://127.0.0.1:7341/**', async route => {
    const request: Request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(request.url()).pathname;
    if (path === '/speakers') {
      return route.fulfill({ headers: CORS, json: { speakers: outputs.map(output => output.name), outputs } });
    }
    if (path === '/audio/route') {
      const { outputs: ids } = request.postDataJSON() as { outputs: string[] };
      routes.push(ids);
      for (const output of outputs) output.linked = ids.includes(output.id);
    } else if (path === '/audio/volume') {
      const body = request.postDataJSON() as { output: string; volume: number };
      volumes.push(body);
      const output = outputs.find(candidate => candidate.id === body.output);
      if (output) output.volume = body.volume;
    }
    const json = EMPTY_LISTS[path];
    return route.fulfill(json ? { headers: CORS, json } : { status: 204, headers: CORS });
  });
  await page.addInitScript(() => {
    localStorage.setItem('maxmix.kiosk', 'true');
  });
  return { routes, volumes };
}

/** The networks the Pi's Wi-Fi sees (pi/kiosk-audio/nmcli.ts), the one it is on first. */
const FAKE_NETWORKS = [
  { ssid: 'Home network', bars: 4, security: 'psk' },
  { ssid: 'Neighbour', bars: 3, security: 'psk' },
  { ssid: 'Cafe guest', bars: 2, security: 'open' },
  { ssid: 'Old router', bars: 1, security: 'unsupported' }
] as const;

/**
 * What the Pi answers to the Wi-Fi page's GETs: the network it is on (`ssid`) and FAKE_NETWORKS in range. Undefined for
 * any other request.
 */
export function wifiAnswer(request: Request, ssid: string | null) {
  const answers: Record<string, object | undefined> = {
    '/wifi/status': { ssid, address: null },
    '/wifi/networks': { networks: FAKE_NETWORKS }
  };
  const json = request.method() === 'GET' ? answers[new URL(request.url()).pathname] : undefined;
  return json && { headers: CORS, json };
}

/** How a phone joins the Pi's setup hotspot (pi/kiosk-audio/hotspot.ts), as POST /wifi/hotspot answers. */
const FAKE_HOTSPOT = {
  ssid: 'THE MAX MIX setup',
  // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a made-up hotspot password, as hotspot.ts makes them
  password: 'K7PX4RMW2N',
  // eslint-disable-next-line sonarjs/no-clear-text-protocols -- the hotspot's page is plain HTTP on the Pi
  url: 'http://10.42.0.1/',
  wifiQr: [],
  urlQr: []
};

/**
 * What the Pi answers while a phone sets up its Wi-Fi: From phone (Bluetooth) and Hotspot start, and each waits for the
 * phone, or the hotspot says `hotspotState` (`connected` once a phone is on it, `joining` Home network). Undefined for any other request.
 */
export function phoneSetupAnswer(request: Request, hotspotState = 'running') {
  const path = new URL(request.url()).pathname;
  const answers: Record<string, object | undefined> =
    request.method() === 'POST'
      ? { '/wifi/phone': { ok: true }, '/wifi/hotspot': FAKE_HOTSPOT }
      : {
          '/wifi/phone': { state: 'waiting' },
          '/wifi/hotspot': { state: hotspotState, ...(hotspotState === 'joining' && { ssid: 'Home network' }) }
        };
  const json = answers[path];
  return json && { headers: CORS, json };
}
