// The lights the kiosk may switch, which are Home Assistant's. The Pi's service does all of it (server/src/lights.ts):
// it reads which lights the owner allowed from the kiosk's config on countdown-server, holds the sign-in to Home
// Assistant, and follows and switches the lights. This page only says where the config is (with the device secret, as
// for Soloist), shows what the service reports and asks it to switch a light; no token of Home Assistant's reaches it.

import type { Client } from '../../../vendor/countdown-api/src/countdown_api/client';
import { serverClient } from '../countdown/config';
import { KIOSK_SERVICE, kioskPost } from '../utils/kioskService';

/** A light as the service reports it. */
export interface Light {
  /** Its Home Assistant entity ID. */
  id: string;
  name: string;
  on: boolean;
  /** In percent (1 to 100); null when it is off or does not dim. */
  brightness: number | null;
  dimmable: boolean;
  /** Whether Home Assistant can reach it. */
  available: boolean;
}

/**
 * Where the lights stand (server/src/lights.ts's LightsPhase): `off` when the config has none, `signed-out` when the
 * kiosk is not signed in to Home Assistant, `connecting`, `ready`, or `unreachable` while Home Assistant can't be
 * reached.
 */
export type LightsPhase = 'off' | 'signed-out' | 'connecting' | 'ready' | 'unreachable';

export interface LightsStatus {
  state: LightsPhase;
  lights: Light[];
}

const PHASES = new Set<string>(['off', 'signed-out', 'connecting', 'ready', 'unreachable']);

function parseLight(value: unknown): Light | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, name, on, brightness, dimmable, available } = value as Record<string, unknown>;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof on !== 'boolean') return null;
  return {
    id,
    name,
    on,
    brightness: typeof brightness === 'number' ? brightness : null,
    dimmable: dimmable === true,
    available: available === true
  };
}

/** What the service sent as a status, or null when it is not one. */
export function parseLightsStatus(value: unknown): LightsStatus | null {
  if (typeof value !== 'object' || value === null) return null;
  const { state, lights } = value as Record<string, unknown>;
  if (typeof state !== 'string' || !PHASES.has(state) || !Array.isArray(lights)) return null;
  return {
    state: state as LightsPhase,
    lights: lights.map(light => parseLight(light)).filter(light => light !== null)
  };
}

/**
 * Tells the service where the kiosk's config is, so it reads the allowed lights from it; resolves with where the
 * lights stand, or null when the kiosk isn't registered or the service did not answer (an older one has no lights).
 */
export async function configureLights(client: Client | null = serverClient()): Promise<LightsStatus | null> {
  if (!client) return null;
  try {
    const response = await fetch(`${KIOSK_SERVICE}/lights/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: client.baseUrl, secret: client.secret })
    });
    return response.ok ? parseLightsStatus(await response.json()) : null;
  } catch {
    return null;
  }
}

/**
 * Calls `onStatus` with where the lights stand, now and after every change (GET /lights/events); returns how to stop.
 * The browser opens a dropped stream again by itself.
 */
export function watchLights(onStatus: (status: LightsStatus) => void): () => void {
  // Without EventSource (tests, very old browsers) the status from configureLights is all there is.
  if (typeof EventSource === 'undefined') return () => {};
  const source = new EventSource(`${KIOSK_SERVICE}/lights/events`);
  source.addEventListener('message', (event: MessageEvent<string>) => {
    let status: LightsStatus | null;
    try {
      status = parseLightsStatus(JSON.parse(event.data));
    } catch {
      return;
    }
    if (status) onStatus(status);
  });
  return () => {
    source.close();
  };
}

/** Asks the service to turn a light on or off, or on at a brightness (1 to 100 percent). */
export function setLight(id: string, isOn: boolean, brightness?: number): void {
  kioskPost('/lights/set', { id, on: isOn, ...(brightness !== undefined && { brightness }) });
}
