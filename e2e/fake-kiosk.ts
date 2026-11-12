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
