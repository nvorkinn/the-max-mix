// The kiosk's config from countdown-server: GET /api/devices/config, with the raw device secret as a bearer token, and
// saves of one section of it from the Settings tab. The server is the one source of truth for it; the kiosk keeps a copy
// of the last one it got in localStorage, for starts while the server can't be reached. The types are countdown-api's,
// generated from its contract.

import createClient from 'openapi-fetch';
import type { ConfigResponse, TouchscreenConfig, paths } from 'countdown-api';
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

/** A client for countdown-server with the device secret, or null when the kiosk isn't registered with one. */
function serverClient() {
  const server = countdownServer();
  const credentials = deviceCredentials();
  if (!server || !credentials) return null;
  return {
    client: createClient<paths>({ baseUrl: server }),
    headers: { Authorization: `Bearer ${credentials.secret}` }
  };
}

/** The server's answer, or null when the kiosk isn't registered, the server can't be reached or refuses it. */
async function fetchDeviceConfig(): Promise<TouchscreenConfig | null> {
  const server = serverClient();
  if (!server) return null;
  try {
    const { data } = await server.client.GET('/api/devices/config', { headers: server.headers });
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

/** The parts of the config the Settings tab changes, each saved whole: the time format and the owner's sections. */
export type ConfigSection = 'clock_format' | 'style' | 'display' | 'arrivals' | 'weather' | 'notice_board';

/**
 * What a save comes to: the config as the server saved it; `conflict` when the server says the copy the change was made
 * to is out of date (or, until per-section saves land, that no one owns the kiosk yet), so the config is to be loaded
 * again; `failed` when the server refused the change or couldn't be reached, so it is to be undone.
 */
export type SaveResult = { saved: TouchscreenConfig } | { error: 'conflict' | 'failed' };

/**
 * Saves one section of the config: `base` (the config as the kiosk last got it) with `section` replaced. The contract
 * has only the whole-config PUT /api/devices/config so far, so the section goes in the whole config; the rework plan's
 * per-section PUT /api/devices/config/{section} with If-Match takes its place here once countdown-api has it, and nothing
 * else changes. A mock build saves nothing and answers as the server would.
 */
export async function saveConfigSection<K extends ConfigSection>(
  base: TouchscreenConfig,
  section: K,
  value: TouchscreenConfig[K]
): Promise<SaveResult> {
  const changed: TouchscreenConfig = { ...base, [section]: value };
  if (import.meta.env.VITE_COUNTDOWN_CONFIG === 'mock') {
    cache(changed);
    return { saved: changed };
  }
  const server = serverClient();
  if (!server) return { error: 'failed' };
  try {
    const { data, response } = await server.client.PUT('/api/devices/config', {
      headers: server.headers,
      body: changed
    });
    if (response.status === 409) return { error: 'conflict' };
    if (!isTouchscreen(data)) return { error: 'failed' };
    cache(data);
    return { saved: data };
  } catch {
    return { error: 'failed' };
  }
}
