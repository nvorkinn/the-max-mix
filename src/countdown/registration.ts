// The kiosk's identity on countdown-server. The kiosk makes up its own secret and keeps it, with the device ID the
// server gives it, in localStorage. A new kiosk registers itself through the screens' API (POST /api/devices/register,
// with the secret and the screen as the Pi reports it: its size, and whether its brightness can be set), which makes
// it a device nobody owns yet. It then shows a QR code of the settings site's pairing page with its pairing token (a
// hash of its secret's hash, so nothing secret is in it); whoever scans it signs in on their phone and becomes its
// owner. The kiosk asks the server every few seconds whether it has an owner, and keeps its device ID once it has.
// Nothing signs in on the kiosk itself, so no sign-in is left waiting on its screen for someone to come by.

import type { TouchscreenRegistration } from 'countdown-api';
import { getAccount, registerDevice } from '../../vendor/countdown-api/src/countdown_api/client';
import { isKiosk } from '../utils/kiosk';
import { KIOSK_SERVICE } from '../utils/kioskService';
import { countdownApi, countdownServer } from './server';

const SECRET_KEY = 'maxmix.deviceSecret';
const DEVICE_ID_KEY = 'maxmix.deviceId';
const DEVICE_ID_PATTERN = /^[\w-]{1,64}$/;
// Set once the first-time setup wizard is done (components/setup/SetupWizard.tsx).
const SETUP_DONE_KEY = 'maxmix.setupDone';

/** The kiosk's secret and the device ID the server gave it, once it is registered. */
export interface DeviceCredentials {
  deviceId: string;
  secret: string;
}

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

/** The kiosk's credentials, or null until it is registered and someone owns it. */
export function deviceCredentials(): DeviceCredentials | null {
  const deviceId = read(DEVICE_ID_KEY);
  const secret = read(SECRET_KEY);
  return deviceId && secret ? { deviceId, secret } : null;
}

/**
 * Forgets the device ID and the secret, so the next start is a new screen to the server and goes through the setup
 * wizard again (the debug console's Register again).
 */
export function forgetRegistration(): void {
  try {
    localStorage.removeItem(DEVICE_ID_KEY);
    localStorage.removeItem(SECRET_KEY);
    localStorage.removeItem(SETUP_DONE_KEY);
  } catch {
    // Storage is unavailable, so there was nothing kept to forget.
  }
}

/** The kiosk's secret, made up (32 random bytes, as hex) the first time. */
export function deviceSecret(): string {
  const kept = read(SECRET_KEY);
  if (kept) return kept;
  const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
  localStorage.setItem(SECRET_KEY, secret);
  return secret;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

/** The secret's SHA-256 hash, as lowercase hex: what the server keeps of it. */
export function secretHash(secret: string): Promise<string> {
  return sha256Hex(secret);
}

/**
 * The pairing token the settings site's pairing page takes for this secret: the hex SHA-256 of "pairing:" and the
 * secret's hash, as countdown-server derives it (services/pairing.token_for). One-way from the secret.
 */
export async function pairingToken(secret: string): Promise<string> {
  return sha256Hex(`pairing:${await secretHash(secret)}`);
}

/** The settings site's pairing page for a token, behind its sign-in: the address the kiosk's QR code holds. */
export function pairingPageUrl(server: string, token: string): string {
  const url = new URL('/pair/add', server);
  url.searchParams.set('t', token);
  return url.href;
}

/**
 * Whether the kiosk still has to go through its first-time setup (components/setup/SetupWizard.tsx) before anything
 * else: on the kiosk, with the server's settings site and API named in this build, the wizard not yet finished, and
 * storage that can keep the secret (without it, every start would be a new screen).
 */
export function needsSetup(): boolean {
  return isKiosk() && countdownServer() !== null && countdownApi() !== null && read(SETUP_DONE_KEY) === null && canStore();
}

/** The wizard is done: the next start opens the app. */
export function finishSetup(): void {
  try {
    localStorage.setItem(SETUP_DONE_KEY, '1');
  } catch {
    // Storage is unavailable: the wizard comes back at the next start, with every chapter ticked.
  }
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

/**
 * Registers the kiosk with the screens' API as a touchscreen nobody owns yet (a repeat is fine: the same secret is
 * the same device). Answers its device ID, or null when the server can't be reached or refuses for now.
 */
export async function registerScreen(secret: string, screen: KioskScreen): Promise<string | null> {
  const api = countdownApi();
  if (!api) return null;
  try {
    const { data } = await registerDevice({ baseUrl: api }, { secret, type: 'touchscreen', ...screen });
    const deviceId = data?.device_id;
    return deviceId && DEVICE_ID_PATTERN.test(deviceId) ? deviceId : null;
  } catch {
    return null;
  }
}

/**
 * Whether someone owns the kiosk yet, by asking for its owner's account's links (GET /api/devices/account): `paired`,
 * `waiting` while nobody does (409), `unregistered` when the server doesn't know the secret (401: an unpaired screen
 * is dropped after a day), or `unknown` when the server can't be reached.
 */
export async function pairingState(secret: string): Promise<'paired' | 'waiting' | 'unregistered' | 'unknown'> {
  const api = countdownApi();
  if (!api) return 'unknown';
  try {
    const { response } = await getAccount({ baseUrl: api, secret });
    if (response.ok) return 'paired';
    if (response.status === 409) return 'waiting';
    if (response.status === 401) return 'unregistered';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Keeps the device ID beside the secret, once someone owns the kiosk; false when storage can't keep it. */
export function keepDeviceId(deviceId: string): boolean {
  try {
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
    return true;
  } catch {
    return false;
  }
}
