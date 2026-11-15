import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

const fixture = JSON.parse(
  readFileSync(new URL('../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json', import.meta.url), 'utf8')
) as { pairing: object; config: object };

// The countdown-server the build names (.env.production).
const CONFIG = 'https://app.countdown.build/api/devices/config';
// The config site's page for a device, which the Settings tab's Device page shows in a frame.
const DEVICE_PAGE = 'https://app.countdown.build/device/**';

/** countdown-api's example configs: `pairing` before anyone owns the kiosk (it changes nothing), `config` after. */
export const DEVICE_CONFIGS = { pairing: fixture.pairing, owned: fixture.config };

/**
 * Stands in for countdown-server's config route, which the app asks once at start (the tests start registered: see
 * playwright.config.ts). Answers the pairing value unless a test gives a config, and the CORS headers the real server
 * sends the app's origin. Returns the Authorization header of each request.
 */
export async function fakeCountdownServer(page: Page, config: object = DEVICE_CONFIGS.pairing) {
  const authorizations: string[] = [];
  await page.route(CONFIG, route => {
    const request = route.request();
    const cors = {
      'Access-Control-Allow-Origin': request.headers()['origin'] ?? '*',
      'Access-Control-Allow-Headers': 'Authorization',
      'Access-Control-Allow-Methods': 'GET, PUT'
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    authorizations.push(request.headers()['authorization'] ?? '');
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(config) });
  });
  await page.route(DEVICE_PAGE, route =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><body style="margin:24px;font:20px sans-serif">Device settings</body>'
    })
  );
  return { authorizations };
}
