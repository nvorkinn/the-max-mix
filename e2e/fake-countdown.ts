import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

const fixture = JSON.parse(
  readFileSync(new URL('../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json', import.meta.url), 'utf8')
) as { config: object };

const search = JSON.parse(
  readFileSync(new URL('../vendor/countdown-api/src/countdown_api/fixtures/search.json', import.meta.url), 'utf8')
) as { stops_query: string; stops: object[]; places_query: string; places: object[] };

// countdown-server's screens' API, as the build names it (.env.production).
const API = 'https://api.countdown.build';
export const CONFIG = `${API}/api/devices/config`;

/**
 * countdown-api's example config, once someone owns the kiosk. Before that there's none: a touchscreen registers through
 * its owner's sign-in, so the server doesn't know an unowned kiosk's secret.
 */
export const DEVICE_CONFIGS = { owned: fixture.config };

/**
 * Stands in for countdown-server's config route, which the app asks at start and each time the Settings tab opens (the
 * tests start registered: see playwright.config.ts). Answers 401, as for a secret it doesn't know, unless a test gives a
 * config, and the CORS headers the real server sends the app's origin. A save (PUT) is answered with what was sent, or
 * `saveStatus` with no body when a test gives one. Returns the Authorization header of each request and the body of each save.
 */
export async function fakeCountdownServer(
  page: Page,
  config: object | null = null,
  { saveStatus }: { saveStatus?: number } = {}
) {
  const authorizations: string[] = [];
  const saves: Record<string, unknown>[] = [];
  await page.route(CONFIG, route => {
    const request = route.request();
    const cors = {
      'Access-Control-Allow-Origin': request.headers()['origin'] ?? '*',
      'Access-Control-Allow-Headers': 'Authorization',
      'Access-Control-Allow-Methods': 'GET, PUT'
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    authorizations.push(request.headers()['authorization'] ?? '');
    if (request.method() === 'PUT') {
      const body = request.postDataJSON() as Record<string, unknown>;
      saves.push(body);
      return route.fulfill(
        saveStatus === undefined
          ? { status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) }
          : { status: saveStatus, headers: cors }
      );
    }
    return route.fulfill(
      config === null
        ? { status: 401, headers: cors }
        : { status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(config) }
    );
  });
  // The searches answer countdown-api's example: its stops for "oslo s", its places for "oslo", and nothing else.
  const searches = [
    ['/api/stops/search', search.stops_query, search.stops],
    ['/api/places/search', search.places_query, search.places]
  ] as const;
  await Promise.all(
    searches.map(([path, query, results]) =>
      page.route(`${API}${path}?*`, route => {
        const request = route.request();
        const cors = {
          'Access-Control-Allow-Origin': request.headers()['origin'] ?? '*',
          'Access-Control-Allow-Headers': 'Authorization'
        };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        const asked = new URL(request.url()).searchParams.get('q');
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify(asked === query ? results : [])
        });
      })
    )
  );
  return { authorizations, saves };
}
