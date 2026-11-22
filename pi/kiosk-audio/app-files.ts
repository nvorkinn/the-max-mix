// Serves the web app that the release installed on the Pi (KIOSK_APP_DIR, /opt/the-max-mix/app/current), so the kiosk
// starts the app with no internet. The folder is Vite's build (dist/) at the release's commit; the Ansible role
// installs each release in a folder of its own and points `current` at it only when the kiosk starts
// (kiosk-app-switch), so a page that is already open never asks for files that a newer release removed.
//   GET /                 index.html (the app takes everything else it needs from the query: ?kiosk=1&pi_ref=…)
//   GET /assets/…         the built scripts, styles and images, whose names carry a hash of their content
//   GET /<file>           anything else at the top of the build (public/)
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

/** A file of the app: its media type, its bytes and how long the browser may keep it. */
export interface AppFile {
  type: string;
  body: Buffer;
  cache: string;
}

const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

/** A hashed file never changes under its name; everything else is checked again on each load. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

/** The headers every app file goes out with, as the hosted site's server would send them. */
export const APP_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY'
};

/**
 * The file of the app in `folder` that a GET of `url` asks for, or null when there is none (or the URL is not a plain
 * path inside the folder). The folder's link is followed once it is there, so one service serves one release however
 * `current` moves.
 */
export function appFiles(folder: string): (url: string) => Promise<AppFile | null> {
  let root: string | null = null;
  return async url => {
    // Until the first release is installed there is no folder; it is looked for again on the next request.
    root ??= await resolved(folder);
    const base = root;
    if (!base) return null;
    const file = fileFor(base, url);
    if (!file) return null;
    try {
      const body = await readFile(file);
      const relative = path.relative(base, file);
      const cache = relative.startsWith(`assets${path.sep}`) ? IMMUTABLE : REVALIDATE;
      return { type: TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', body, cache };
    } catch {
      return null;
    }
  };
}

/** The folder with its links followed, or null when there is none (until the first release is installed). */
async function resolved(folder: string): Promise<string | null> {
  if (!folder) return null;
  try {
    return await realpath(folder);
  } catch {
    return null;
  }
}

/** The path in `base` for the URL, or null for one that would leave it, is hidden or has no extension. */
export function fileFor(base: string, url: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname === '/') pathname = '/index.html';
  if (
    pathname.includes('\0') ||
    pathname.split('/').some(part => part.startsWith('.')) ||
    !path.posix.extname(pathname)
  ) {
    return null;
  }
  const file = path.join(base, pathname);
  return file.startsWith(base + path.sep) ? file : null;
}
