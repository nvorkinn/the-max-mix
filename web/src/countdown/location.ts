// Where a new kiosk is, for the setup wizard's Location chapter (components/setup/SetupLocation.tsx): the Wi-Fi
// networks the Pi can see (its service's GET /location/scan), which countdown-server places
// and gives the UK postcodes nearest (POST /api/devices/locate), and where a postcode typed instead is
// (GET /api/postcodes/lookup). Both with the device secret. A build that sets VITE_COUNTDOWN_CONFIG=mock answers
// countdown-api's example (fixtures/locate.json) instead, and scans nothing.

import type { DeviceLocation, NearbyStopResult, Postcode, WifiAccessPoint } from 'countdown-api';
import { locateDevice, lookupPostcode } from '../../../vendor/countdown-api/src/countdown_api/client';
import { KIOSK_SERVICE } from '../utils/kioskService';
import { serverClient } from './config';

/** A position, as the routes that take one ask for it. */
export interface Position {
  latitude: number;
  longitude: number;
}

interface LocateFixture {
  locate: DeviceLocation;
  postcode: Postcode;
  stops_near: NearbyStopResult[];
}

/** countdown-api's example answers to the location routes, for a build that mocks the server. */
export async function mockLocation(): Promise<LocateFixture> {
  const fixture = await import('../../../vendor/countdown-api/src/countdown_api/fixtures/locate.json');
  return fixture.default as unknown as LocateFixture;
}

const isMock = () => import.meta.env.VITE_COUNTDOWN_CONFIG === 'mock';

function isAccessPoint(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const { macAddress, signalStrength } = value as Record<string, unknown>;
  return typeof macAddress === 'string' && typeof signalStrength === 'number';
}

/**
 * The Wi-Fi access points the Pi can see, strongest first, as the server takes them; null when its service can't scan
 * (or isn't there: off the Pi). The service has already left out hidden networks, `_nomap` ones and its own hotspot.
 */
export async function scanAccessPoints(signal?: AbortSignal): Promise<WifiAccessPoint[] | null> {
  try {
    const response = await fetch(`${KIOSK_SERVICE}/location/scan`, { signal: signal ?? null });
    if (!response.ok) return null;
    const body = (await response.json()) as { accessPoints?: unknown };
    if (!Array.isArray(body.accessPoints)) return null;
    return body.accessPoints.filter(isAccessPoint).map(point => {
      const { macAddress, signalStrength, channel, age } = point;
      return {
        mac_address: macAddress as string,
        signal_strength: signalStrength as number,
        ...(typeof channel === 'number' && { channel }),
        ...(typeof age === 'number' && { age })
      };
    });
  } catch {
    return null;
  }
}

/** The fewest access points the server takes (Google's Geolocation API needs two), and the most. */
const FEWEST_ACCESS_POINTS = 2;
const MOST_ACCESS_POINTS = 30;

/**
 * Where the kiosk is, and the postcodes nearest it, from the Wi-Fi networks it can see. Null when it can't be told:
 * the Pi can't scan or sees too few networks, the kiosk isn't registered, or the server finds no position, is asked too
 * often, or can't ask Google.
 */
export async function locateKiosk(signal?: AbortSignal): Promise<DeviceLocation | null> {
  if (isMock()) {
    const fixture = await mockLocation();
    return fixture.locate;
  }
  const client = serverClient();
  if (!client) return null;
  const accessPoints = await scanAccessPoints(signal);
  if (!accessPoints || accessPoints.length < FEWEST_ACCESS_POINTS) return null;
  const answer = await locateDevice(
    client,
    { wifi_access_points: accessPoints.slice(0, MOST_ACCESS_POINTS) },
    { ...(signal && { signal }) }
  ).catch(() => null);
  return answer?.data ?? null;
}

/**
 * Where a postcode the owner typed is (one in a UK or Norwegian postcode's form): its position, `unknown` when there is
 * no such postcode, or `failed` when the server can't be asked.
 */
export async function findPostcode(postcode: string): Promise<Position | 'unknown' | 'failed'> {
  if (isMock()) {
    const fixture = await mockLocation();
    return { latitude: fixture.postcode.latitude, longitude: fixture.postcode.longitude };
  }
  const client = serverClient();
  if (!client) return 'failed';
  const answer = await lookupPostcode(client, { postcode }).catch(() => null);
  if (answer?.data) return { latitude: answer.data.latitude, longitude: answer.data.longitude };
  return answer?.response.status === 404 ? 'unknown' : 'failed';
}

/** How far apart two positions are, in metres (on a sphere the Earth's size: near enough for a few hundred metres). */
export function metresBetween(from: Position, to: Position): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLatitude = radians(to.latitude - from.latitude);
  const dLongitude = radians(to.longitude - from.longitude);
  const a =
    Math.sin(dLatitude / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLongitude / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * What the setup wizard found in the background: where the kiosk is, with the postcodes nearest it, and the stops
 * nearest that position (null when they couldn't be had, so the stops page asks again).
 */
export interface SetupLocation<S = unknown> {
  location: DeviceLocation;
  stops: S[] | null;
}

// What was found during setup, and when. Signing in reloads the page in the middle of setup, and the scan takes a few
// seconds, so an answer found before it is used again for a while.
const SETUP_LOCATION_KEY = 'maxmix.setupLocation';
/** How long a found location is used again rather than scanning once more: a kiosk being set up doesn't move. */
export const SETUP_LOCATION_MAX_AGE_MS = 60 * 60 * 1000;

/** What was found less than an hour ago, or null when there is nothing (or storage is unavailable). */
export function keptSetupLocation<S>(now = Date.now()): SetupLocation<S> | null {
  try {
    const stored = localStorage.getItem(SETUP_LOCATION_KEY);
    if (stored === null) return null;
    const kept = JSON.parse(stored) as { foundAt?: unknown; location?: DeviceLocation; stops?: unknown };
    const { foundAt, location } = kept;
    if (
      typeof foundAt !== 'number' ||
      !location ||
      !Array.isArray(location.postcodes) ||
      foundAt > now ||
      now >= foundAt + SETUP_LOCATION_MAX_AGE_MS
    ) {
      return null;
    }
    return { location, stops: Array.isArray(kept.stops) ? (kept.stops as S[]) : null };
  } catch {
    return null;
  }
}

/** Keeps what was found, with when it was. */
export function keepSetupLocation<S>(found: SetupLocation<S>, now = Date.now()): void {
  try {
    localStorage.setItem(SETUP_LOCATION_KEY, JSON.stringify({ foundAt: now, ...found }));
  } catch {
    // Storage is unavailable: the next start of the page scans again.
  }
}
