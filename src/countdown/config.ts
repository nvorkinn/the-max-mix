// The kiosk's config from countdown-server: GET /api/devices/config, with the raw device secret as a bearer token. The
// server is the one source of truth for it; the kiosk keeps a copy of the last one it got in localStorage, for starts
// while the server can't be reached. The call and its types are countdown-api's, generated from its contract.

import type { ConfigResponse, TouchscreenConfig } from 'countdown-api';
import { getConfig } from '../../vendor/countdown-api/src/countdown_api/client';
import { deviceCredentials } from './registration';
import { countdownServer } from './server';

const CONFIG_KEY = 'maxmix.deviceConfig';

function isTouchscreen(config: ConfigResponse | null | undefined): config is TouchscreenConfig {
  return config?.type === 'touchscreen';
}

/** The last config the server gave, or null when there is none (or storage is unavailable). */
export function cachedDeviceConfig(): TouchscreenConfig | null {
  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (stored === null) return null;
    const config = JSON.parse(stored) as ConfigResponse;
    return isTouchscreen(config) ? config : null;
  } catch {
    return null;
  }
}

/** Forgets the last config, which belongs to the device ID being forgotten (the debug console's Register again). */
export function forgetDeviceConfig(): void {
  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    // Storage is unavailable, so there was no config kept.
  }
}

function cache(config: TouchscreenConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Storage is unavailable; the next start without the server then has no config.
  }
}

/** The server's answer, or null when the kiosk isn't registered, the server can't be reached or refuses it. */
async function fetchDeviceConfig(): Promise<TouchscreenConfig | null> {
  const server = countdownServer();
  const credentials = deviceCredentials();
  if (!server || !credentials) return null;
  try {
    const { data } = await getConfig({ baseUrl: server, secret: credentials.secret });
    return isTouchscreen(data) ? data : null;
  } catch {
    return null;
  }
}

/** countdown-api's example touchscreen config, for a build that sets VITE_COUNTDOWN_CONFIG=mock. */
async function mockDeviceConfig(): Promise<TouchscreenConfig | null> {
  const fixture = await import('../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json');
  const config = fixture.default.config as ConfigResponse;
  return isTouchscreen(config) ? config : null;
}

/**
 * The kiosk's config: the server's (or the mock's, in a build that asks for it), kept for next time; the last one kept
 * when there is no answer; null when there has never been one.
 */
export async function loadDeviceConfig(): Promise<TouchscreenConfig | null> {
  const config =
    import.meta.env.VITE_COUNTDOWN_CONFIG === 'mock' ? await mockDeviceConfig() : await fetchDeviceConfig();
  if (!config) return cachedDeviceConfig();
  cache(config);
  return config;
}
