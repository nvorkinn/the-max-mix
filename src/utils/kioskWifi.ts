// The kiosk's Wi-Fi, through its service (pi/kiosk-audio/server.ts): the networks in range, and joining one. The service
// only lets its own origin change the network, which is the app's once the Pi serves it. Its messages come in English;
// `localize` (words.ts, the service's own catalogue) says them in the tablet's language.

import { localize } from '../../pi/kiosk-audio/words';
import type { Language } from '../../pi/kiosk-audio/words';
import { KIOSK_SERVICE } from './kioskService';

/** A network in range, as the service lists it: how strong (0 to 4 bars) and whether it needs a password. */
export interface WifiNetwork {
  ssid: string;
  bars: number;
  security: 'open' | 'psk' | 'unsupported';
}

/** The networks in range, and the service's message (localized) when the scan failed; null when it did not answer. */
export interface WifiScan {
  networks: WifiNetwork[];
  error?: string | null;
}

/** Joined, or why not: the service's message (localized), or null when it did not answer. */
interface WifiFailure {
  ok: false;
  error: string | null;
}
export type WifiResult = WifiFailure | { ok: true };

const SECURITIES: ReadonlySet<string> = new Set(['open', 'psk', 'unsupported']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseNetwork(value: unknown): WifiNetwork | null {
  if (!isRecord(value)) return null;
  const { ssid, bars, security } = value;
  if (typeof ssid !== 'string' || ssid === '' || typeof bars !== 'number' || typeof security !== 'string') return null;
  return SECURITIES.has(security)
    ? { ssid, bars: Math.max(0, Math.min(4, Math.round(bars))), security: security as WifiNetwork['security'] }
    : null;
}

function errorOf(body: unknown, language: Language): string | undefined {
  return isRecord(body) && typeof body['error'] === 'string' ? localize(body['error'], language) : undefined;
}

/** Asks the kiosk which networks are in range. */
export async function scanWifi(language: Language, signal: AbortSignal | null = null): Promise<WifiScan> {
  try {
    const response = await fetch(`${KIOSK_SERVICE}/wifi/networks`, { signal });
    const body: unknown = await response.json();
    const listed = isRecord(body) && Array.isArray(body['networks']) ? (body['networks'] as unknown[]) : [];
    const networks = listed.map(network => parseNetwork(network)).filter(network => network !== null);
    const error = errorOf(body, language);
    return error === undefined ? { networks } : { networks, error };
  } catch {
    return { networks: [], error: null };
  }
}

/**
 * Asks the kiosk to join a network: one from the list, or a hidden one by name (`hidden`). An open network has no
 * password. Resolves when the kiosk has joined it or given up, which can take a while.
 */
export async function joinWifi(
  request: { ssid: string; password: string; hidden: boolean; security: 'open' | 'psk' },
  language: Language
): Promise<WifiResult> {
  try {
    const response = await fetch(`${KIOSK_SERVICE}/wifi/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    const body: unknown = await response.json();
    return isRecord(body) && body['ok'] === true ? { ok: true } : { ok: false, error: errorOf(body, language) ?? null };
  } catch {
    return { ok: false, error: null };
  }
}

/** How a phone joins the kiosk's setup hotspot, and the address of the page it then gets. */
export interface HotspotInfo {
  ssid: string;
  password: string;
  url: string;
}

/**
 * Where a setup from a phone (over Bluetooth, or over the hotspot) is: waiting for the phone, joining the network it
 * sent, joined, failed, or ended (its few minutes ran out). `error` is the service's message (localized) about a network
 * that could not be joined: the hotspot has then ended, while Bluetooth waits for the phone to send another.
 */
export interface SetupStatus {
  state: 'waiting' | 'joining' | 'joined' | 'failed' | 'ended';
  error?: string;
}

/** The service's states for each setup, as the tablet follows them. */
const PHONE_STATES: Readonly<Record<string, SetupStatus['state']>> = {
  idle: 'ended',
  waiting: 'waiting',
  joining: 'joining',
  joined: 'joined'
};
const HOTSPOT_STATES: Readonly<Record<string, SetupStatus['state']>> = {
  idle: 'ended',
  running: 'waiting',
  joining: 'joining',
  joined: 'joined',
  failed: 'failed'
};

async function postSetup(path: string, language: Language): Promise<WifiFailure | { ok: true; body: unknown }> {
  try {
    const response = await fetch(`${KIOSK_SERVICE}${path}`, { method: 'POST' });
    const body: unknown = response.status === 204 ? null : await response.json();
    return response.ok ? { ok: true, body } : { ok: false, error: errorOf(body, language) ?? null };
  } catch {
    return { ok: false, error: null };
  }
}

async function setupStatus(
  path: string,
  states: Readonly<Record<string, SetupStatus['state']>>,
  language: Language,
  signal: AbortSignal | null
): Promise<SetupStatus | undefined> {
  try {
    const response = await fetch(`${KIOSK_SERVICE}${path}`, { signal });
    const body: unknown = await response.json();
    const state = isRecord(body) && typeof body['state'] === 'string' ? states[body['state']] : undefined;
    if (state === undefined) return undefined;
    const error = errorOf(body, language);
    return error === undefined ? { state } : { state, error };
  } catch {
    return undefined;
  }
}

/** Asks the kiosk to let a phone send it a network over Bluetooth (Improv Wi-Fi) for a few minutes. */
export async function startPhoneSetup(language: Language): Promise<WifiResult> {
  const result = await postSetup('/wifi/phone', language);
  return result.ok ? { ok: true } : result;
}

/** Stops listening for a phone. */
export async function stopPhoneSetup(): Promise<void> {
  await postSetup('/wifi/phone/stop', 'en');
}

/** Where the phone's setup is; undefined when the kiosk did not answer (it may be busy changing networks). */
export function phoneSetupStatus(
  language: Language,
  signal: AbortSignal | null = null
): Promise<SetupStatus | undefined> {
  return setupStatus('/wifi/phone', PHONE_STATES, language, signal);
}

/** Asks the kiosk to start its setup hotspot: how to join it, or why it could not. */
export async function startHotspot(language: Language): Promise<WifiFailure | { ok: true; info: HotspotInfo }> {
  const result = await postSetup('/wifi/hotspot', language);
  if (!result.ok) return result;
  const { body } = result;
  if (!isRecord(body)) return { ok: false, error: null };
  const { ssid, password, url } = body;
  return typeof ssid === 'string' && typeof password === 'string' && typeof url === 'string'
    ? { ok: true, info: { ssid, password, url } }
    : { ok: false, error: null };
}

/** Ends the hotspot; the kiosk goes back to the network it was on. */
export async function stopHotspot(): Promise<void> {
  await postSetup('/wifi/hotspot/stop', 'en');
}

/** Where the hotspot is; undefined when the kiosk did not answer (it may be busy changing networks). */
export function hotspotStatus(language: Language, signal: AbortSignal | null = null): Promise<SetupStatus | undefined> {
  return setupStatus('/wifi/hotspot', HOTSPOT_STATES, language, signal);
}
