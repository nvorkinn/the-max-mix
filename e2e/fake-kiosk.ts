import type { Page, Request } from '@playwright/test';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true'
};

/**
 * The Pi as the app sees it, with AirPlay on: the kiosk service (pi/kiosk-audio/server.ts) lists these speakers with
 * their volumes, and the app has `chosen` picked. Returns the volume requests the page sends, as they arrive.
 */
export async function fakeKioskAirPlay(
  page: Page,
  volumes: Record<string, number>,
  chosen: string[]
): Promise<{ speaker: string; volume: number }[]> {
  const sent: { speaker: string; volume: number }[] = [];
  await page.route('https://api.github.com/**', route => route.fulfill({ status: 404 }));
  await page.route('http://127.0.0.1:7341/**', async route => {
    const request: Request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(request.url()).pathname;
    if (path === '/speakers') {
      return route.fulfill({
        headers: CORS,
        json: { speakers: Object.keys(volumes).toSorted((a, b) => a.localeCompare(b)), volumes }
      });
    }
    if (path === '/audio/volume') sent.push(request.postDataJSON() as { speaker: string; volume: number });
    return route.fulfill({ status: 204, headers: CORS });
  });
  await page.addInitScript(speakers => {
    localStorage.setItem('maxmix.kiosk', 'true');
    localStorage.setItem('maxmix.audioRoute', 'airplay');
    localStorage.setItem('maxmix.airplaySpeakers', JSON.stringify(speakers));
  }, chosen);
  return sent;
}
