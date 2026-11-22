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
export type WifiResult = { ok: true } | { ok: false; error: string | null };

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
