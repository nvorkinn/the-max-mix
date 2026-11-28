// The kiosk's config from countdown-server: GET /api/devices/config, with the raw device secret as a bearer token, and
// saves of one section of it from the Settings tab (PUT /api/devices/config/{section}, with the config's version as
// If-Match). The server is the one source of truth for it; the kiosk keeps a copy
// of the last one it got in localStorage, for starts while the server can't be reached. The calls and their types are
// countdown-api's, generated from its contract.

import type { ConfigResponse, TouchscreenConfig } from 'countdown-api';
import { getConfig, putConfigSection } from '../../../vendor/countdown-api/src/countdown_api/client';
import type { Client } from '../../../vendor/countdown-api/src/countdown_api/client';
import { deviceCredentials } from './registration';
import { countdownApi } from './server';

const CONFIG_KEY = 'maxmix.deviceConfig';

// The version (ETag) of the config the server last gave, which a save sends back as If-Match; null until the server has
// given one (a config kept from before is no use: a save needs the version it was changed from).
let version: string | null = null;
// Each save waits for the one before it, so it sends the version that one answered.
let saving: Promise<unknown> = Promise.resolve();

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

/**
 * Forgets the last config and its version, which belong to the device ID being forgotten (the debug console's Register
 * again).
 */
export function forgetDeviceConfig(): void {
  version = null;
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

/** countdown-server's screens' API with the device secret, or null when the kiosk isn't registered with one. */
export function serverClient(): Client | null {
  const server = countdownApi();
  const credentials = deviceCredentials();
  return server && credentials ? { baseUrl: server, secret: credentials.secret } : null;
}

/** The server's answer, or null when the kiosk isn't registered, the server can't be reached or refuses it. */
async function fetchDeviceConfig(): Promise<TouchscreenConfig | null> {
  const server = serverClient();
  if (!server) return null;
  try {
    const { data, response } = await getConfig(server);
    if (!isTouchscreen(data)) return null;
    version = response.headers.get('ETag');
    return data;
  } catch {
    return null;
  }
}

/** countdown-api's example touchscreen config, for a build that sets VITE_COUNTDOWN_CONFIG=mock. */
async function mockDeviceConfig(): Promise<TouchscreenConfig | null> {
  const fixture = await import('../../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json');
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

/** The parts of the config the Settings tab changes, each saved whole: the time format, the language and the owner's sections. */
export type ConfigSection =
  | 'clock_format'
  | 'language'
  | 'style'
  | 'display'
  | 'lyrics'
  | 'holidays'
  | 'arrivals'
  | 'weather'
  | 'notice_board'
  | 'parcels';

/**
 * What a save comes to: the config as the server saved it; `conflict` when the server says the config changed since
 * the kiosk got it, or the kiosk has no version of it to send, so the config is to be loaded again; `failed` when the
 * server refused the change or couldn't be reached, so it is to be undone.
 */
export type SaveResult = { saved: TouchscreenConfig } | { error: 'conflict' | 'failed' };

async function putSection<K extends ConfigSection>(
  section: K,
  value: NonNullable<TouchscreenConfig[K]>
): Promise<SaveResult> {
  if (import.meta.env.VITE_COUNTDOWN_CONFIG === 'mock') {
    const kept = cachedDeviceConfig() ?? (await mockDeviceConfig());
    if (!kept) return { error: 'failed' };
    const changed: TouchscreenConfig = { ...kept, [section]: value };
    cache(changed);
    return { saved: changed };
  }
  const server = serverClient();
  if (!server) return { error: 'failed' };
  if (version === null) return { error: 'conflict' };
  try {
    const { data, response } = await putConfigSection(server, { section }, {}, value, {
      headers: { 'If-Match': version }
    });
    if (response.status === 409 || response.status === 428) return { error: 'conflict' };
    if (!isTouchscreen(data)) return { error: 'failed' };
    version = response.headers.get('ETag');
    cache(data);
    return { saved: data };
  } catch {
    return { error: 'failed' };
  }
}

/**
 * Saves one section of the config whole, as changed from the version the kiosk last got, and answers the config as
 * saved. Saves go one at a time, each from the version the one before answered. A mock build saves nothing and answers
 * as the server would.
 */
export function saveConfigSection<K extends ConfigSection>(
  section: K,
  value: NonNullable<TouchscreenConfig[K]>
): Promise<SaveResult> {
  const result = saving.then(() => putSection(section, value));
  saving = result;
  return result;
}
