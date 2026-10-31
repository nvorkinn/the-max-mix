// The Raspberry Pi kiosk opens the app with ?kiosk=1 (and ?cursor=hidden for its touch screen). Each flag is remembered in the browser's storage so it survives the
// Spotify sign-in redirect, which returns to the plain redirect address without the query. Storage can be unavailable
// (private windows, blocked site data): every access tolerates that.

import { kioskPost } from './kioskService';

const KIOSK_KEY = 'maxmix.kiosk';
const HIDE_CURSOR_KEY = 'maxmix.hideCursor';

/** Asks the kiosk to show its native Wi-Fi panel. */
export function openWifiSettings(): void {
  kioskPost('/wifi');
}

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function write(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, 'true');
    else localStorage.removeItem(key);
  } catch {
    // Storage is unavailable; the flag then lasts only until the page reloads.
  }
}

/** True on the Pi kiosk. ?kiosk=1 in the address remembers that, ?kiosk=0 forgets it; any other address changes nothing. */
export function isKiosk(): boolean {
  const flag = new URLSearchParams(location.search).get('kiosk');
  if (flag === '1') write(KIOSK_KEY, true);
  else if (flag === '0') write(KIOSK_KEY, false);
  return flag === '1' || (flag !== '0' && read(KIOSK_KEY));
}

/** True when the mouse pointer should be hidden (the kiosk's touch screen). ?cursor=hidden remembers that, ?cursor=shown forgets it. */
export function hidesCursor(): boolean {
  const flag = new URLSearchParams(location.search).get('cursor');
  if (flag === 'hidden') write(HIDE_CURSOR_KEY, true);
  else if (flag === 'shown') write(HIDE_CURSOR_KEY, false);
  return flag === 'hidden' || (flag !== 'shown' && read(HIDE_CURSOR_KEY));
}

/** Asks the kiosk to pull its update now; when that changes anything, the kiosk restarts by itself. */
export function updateKiosk(): void {
  kioskPost('/power/update');
}

/** Asks the kiosk to restart the kiosk (Cage and Chromium), which applies an update that waits for a restart. */
export function restartKiosk(): void {
  kioskPost('/power/restart');
}

/** Asks the kiosk to reboot the Pi. */
export function rebootPi(): void {
  kioskPost('/power/reboot');
}

/**
 * What the Pi runs, at the kiosk's last start: the release tag it pulled (v1.2.3, when it follows the latest release) or
 * the branch or tag it is pinned to (kiosk_pull_ref), and the commit its playbook ran from.
 */
export interface PiVersion {
  ref: string;
  commit: string;
}

const PI_VERSION_KEY = 'maxmix.piVersion';
const REF_PATTERN = /^[\w.-]+(?:\/[\w.-]+)*$/;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;

function parsePiVersion(ref: string | null, commit: string | null): PiVersion | null {
  const valid = ref && commit && ref.length <= 100 && REF_PATTERN.test(ref) && COMMIT_PATTERN.test(commit);
  return valid ? { ref, commit } : null;
}

/**
 * The Pi's version from ?pi_ref= and ?pi_commit=, which the kiosk adds to its address. An address with ?kiosk=1 replaces
 * the remembered version (or forgets it, when it has none); any other address keeps it, like the Spotify sign-in redirect.
 */
export function piVersion(): PiVersion | null {
  const params = new URLSearchParams(location.search);
  if (params.get('kiosk') === '1') {
    const version = parsePiVersion(params.get('pi_ref'), params.get('pi_commit'));
    try {
      if (version) {
        localStorage.setItem(PI_VERSION_KEY, `${version.ref} ${version.commit}`);
      } else {
        localStorage.removeItem(PI_VERSION_KEY);
      }
    } catch {
      // Storage is unavailable; the version then lasts only until the page reloads.
    }
    return version;
  }
  try {
    const [ref = null, commit = null] = localStorage.getItem(PI_VERSION_KEY)?.split(' ') ?? [];
    return parsePiVersion(ref, commit);
  } catch {
    return null;
  }
}

/** The repository the Pi pulls (kiosk_pull_repo). */
const PI_REPO = 'nvorkinn/the-max-mix';

const RELEASE_PATTERN = /^v[0-9A-Za-z][0-9A-Za-z._-]*$/;

/** True when the Pi's ref is a release tag (v1.2.3), so a newer version is a newer release rather than a newer commit. */
export function isRelease(ref: string): boolean {
  return RELEASE_PATTERN.test(ref);
}

/** The tag of the repository's latest GitHub release, or null when GitHub cannot be asked (offline, rate limited). */
export async function latestRelease(signal: AbortSignal | null = null): Promise<string | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${PI_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const tag = typeof body === 'object' && body !== null && 'tag_name' in body ? body.tag_name : null;
    return typeof tag === 'string' && isRelease(tag) ? tag : null;
  } catch {
    return null;
  }
}

/** The commit `ref` points at on GitHub now, or null when GitHub cannot be asked (offline, rate limited). */
export async function latestCommit(ref: string, signal: AbortSignal | null = null): Promise<string | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${PI_REPO}/commits/${encodeURIComponent(ref)}`, {
      headers: { Accept: 'application/vnd.github.sha' },
      signal
    });
    if (!response.ok) return null;
    const body = await response.text();
    const sha = body.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}
