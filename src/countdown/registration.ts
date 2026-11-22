// The kiosk's identity on countdown-server. The kiosk makes up its own secret and keeps it, with the device ID the
// server gives it, in localStorage. To register, the whole page goes to the server's /register page (behind the
// sign-in, so the person signing in becomes the screen's owner) with only the secret's SHA-256 hash, never the secret,
// and the screen as the Pi reports it (its size, and whether its brightness can be set); the server sends the browser
// back to `return_to` with `device_id`, or `error=taken` when someone else owns it.

import type { TouchscreenRegistration } from 'countdown-api';
import { registerTouchscreenUrl } from '../../vendor/countdown-api/src/countdown_api/client';
import { leaveFor } from '../spotify/settings';
import { isKiosk } from '../utils/kiosk';
import { KIOSK_SERVICE } from '../utils/kioskService';
import { countdownServer } from './server';

const SECRET_KEY = 'maxmix.deviceSecret';
const DEVICE_ID_KEY = 'maxmix.deviceId';
// Marks the address the server sends the browser back to, so its `error` is never read as a Spotify sign-in's.
const RETURN_MARK = 'countdown';
const RETURN_VALUE = 'registered';
const RETURN_PARAMETERS = [RETURN_MARK, 'device_id', 'error'];
const DEVICE_ID_PATTERN = /^[\w-]{1,64}$/;

/** The kiosk's secret and the device ID the server gave it, once it is registered. */
export interface DeviceCredentials {
  deviceId: string;
  secret: string;
}

/** What coming back from /register came to: registered, or why not (`taken`: someone else owns this screen). */
export type RegistrationResult = { ok: true; deviceId: string } | { ok: false; error: string };

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function canStore(): boolean {
  try {
    localStorage.setItem('maxmix.storageCheck', '1');
    localStorage.removeItem('maxmix.storageCheck');
    return true;
  } catch {
    return false;
  }
}

/** The kiosk's credentials, or null until it is registered. */
export function deviceCredentials(): DeviceCredentials | null {
  const deviceId = read(DEVICE_ID_KEY);
  const secret = read(SECRET_KEY);
  return deviceId && secret ? { deviceId, secret } : null;
}

/**
 * Forgets the device ID and the secret, so the next registration is a new screen to the server (the debug console's
 * Register again).
 */
export function forgetRegistration(): void {
  try {
    localStorage.removeItem(DEVICE_ID_KEY);
    localStorage.removeItem(SECRET_KEY);
  } catch {
    // Storage is unavailable, so there was nothing kept to forget.
  }
}

/** The kiosk's secret, made up (32 random bytes, as hex) the first time. */
function deviceSecret(): string {
  const kept = read(SECRET_KEY);
  if (kept) return kept;
  const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
  localStorage.setItem(SECRET_KEY, secret);
  return secret;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The secret's SHA-256 hash, as lowercase hex: all the /register page is told. */
export async function secretHash(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return toHex(new Uint8Array(digest));
}

/**
 * Whether the app should go to /register now rather than start: on the kiosk, online (offline it starts unregistered and
 * the next start tries again), with a server named in this build, nothing registered yet, and storage that can keep the
 * secret (without it, every start would register anew).
 */
export function needsRegistration(): boolean {
  return isKiosk() && navigator.onLine && countdownServer() !== null && deviceCredentials() === null && canStore();
}

/** The Pi's screen, as the kiosk's service reads it from the kernel (pi/kiosk-audio/screen.ts). */
export type KioskScreen = Pick<TouchscreenRegistration, 'width' | 'height' | 'brightness_control'>;

/** The screen as the Pi reports it (GET /screen), or null when the Pi cannot say. */
export async function kioskScreen(): Promise<KioskScreen | null> {
  try {
    const response = await fetch(`${KIOSK_SERVICE}/screen`);
    if (!response.ok) return null;
    const { width, height, brightness_control } = (await response.json()) as Record<string, unknown>;
    const isSize = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
    return typeof brightness_control === 'boolean' && isSize(width) && isSize(height)
      ? { width, height, brightness_control }
      : null;
  } catch {
    return null;
  }
}

/** The /register address for this kiosk's secret and screen. */
export async function registrationAddress(server: string, secret: string, screen: KioskScreen): Promise<string> {
  const back = new URL('/', location.origin);
  back.searchParams.set(RETURN_MARK, RETURN_VALUE);
  const fields: TouchscreenRegistration = {
    secret_hash: await secretHash(secret),
    ...screen,
    return_to: back.href
  };
  return registerTouchscreenUrl(server, fields).href;
}

/**
 * Sends the whole page to the server's /register page, and says whether it did: not without a server, or while the Pi
 * cannot say what its screen is. Keeps the secret it had, so a retry registers the same screen.
 */
export async function startRegistration(): Promise<boolean> {
  const server = countdownServer();
  if (!server) return false;
  const screen = await kioskScreen();
  if (!screen) {
    console.warn('The kiosk did not say what its screen is, so it is not registered yet');
    return false;
  }
  leaveFor(await registrationAddress(server, deviceSecret(), screen));
  return true;
}

/**
 * Reads the address /register sent the browser back to, if this is it: keeps the device ID beside the secret and
 * takes the server's parameters out of the address. Null on any other address.
 */
export function completeRegistration(): RegistrationResult | null {
  const query = new URLSearchParams(location.search);
  if (query.get(RETURN_MARK) !== RETURN_VALUE) return null;
  const remaining = new URLSearchParams(location.search);
  for (const name of RETURN_PARAMETERS) remaining.delete(name);
  const search = remaining.size > 0 ? `?${remaining}` : '';
  history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);

  const deviceId = query.get('device_id');
  if (deviceId && DEVICE_ID_PATTERN.test(deviceId) && read(SECRET_KEY)) {
    try {
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
      return { ok: true, deviceId };
    } catch {
      return { ok: false, error: 'storage' };
    }
  }
  return { ok: false, error: query.get('error') || 'unknown' };
}
