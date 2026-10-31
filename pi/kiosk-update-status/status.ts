// Reads the status file /usr/local/sbin/kiosk-pull keeps (one key=value per line) into what the app's settings show.
import { readFile } from 'node:fs/promises';

export const STATES = [
  'idle',
  'checking',
  'downloading',
  'installing',
  'up-to-date',
  'installed',
  'restart-needed',
  'failed'
] as const;
export type UpdateState = (typeof STATES)[number];

export interface UpdateStatus {
  state: UpdateState;
  /** The release tag (or pinned ref) being pulled, or '' before it is known. */
  ref: string;
  /** The commit the playbook ran from, or '' before the end. */
  commit: string;
  /** Seconds since the epoch. */
  started: number;
  updated: number;
  /** The playbook task being run, and how many tasks the last complete run had (0 when unknown). */
  step: number;
  total: number;
  detail: string;
}

export const IDLE: UpdateStatus = {
  state: 'idle',
  ref: '',
  commit: '',
  started: 0,
  updated: 0,
  step: 0,
  total: 0,
  detail: ''
};

// Path segments of word characters, dots and dashes; the length is checked first.
// eslint-disable-next-line security/detect-unsafe-regex -- bounded to 100 characters before it runs
const REF_PATTERN = /^[\w.-]+(?:\/[\w.-]+)*$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function count(value: string | undefined): number {
  return value && /^\d{1,12}$/.test(value) ? Number(value) : 0;
}

/** The status in `text`; anything missing or malformed reads as empty, and an unknown state as idle. */
export function parseStatus(text: string): UpdateStatus {
  const fields = new Map<string, string>();
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) fields.set(line.slice(0, at), line.slice(at + 1));
  }
  const state = STATES.find(name => name === fields.get('state'));
  if (!state) return IDLE;
  const ref = fields.get('ref') ?? '';
  const commit = fields.get('commit') ?? '';
  return {
    state,
    ref: ref.length <= 100 && REF_PATTERN.test(ref) ? ref : '',
    commit: COMMIT_PATTERN.test(commit) ? commit : '',
    started: count(fields.get('started')),
    updated: count(fields.get('updated')),
    step: count(fields.get('step')),
    total: count(fields.get('total')),
    // Printable characters only, as short as kiosk-pull keeps it.
    detail: (fields.get('detail') ?? '').replaceAll(/[\p{Cc}\p{Cf}]/gu, ' ').slice(0, 200)
  };
}

/** The status in `file`, or idle when there is none (no update since the Pi started). */
export async function readStatus(file: string): Promise<UpdateStatus> {
  try {
    return parseStatus(await readFile(file, 'utf8'));
  } catch {
    return IDLE;
  }
}

export interface Request {
  method: string;
  path: string;
  host: string | undefined;
  origin: string | undefined;
}

export interface Response {
  code: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * The answer to one request. Only GET /status from the app's origin, addressed to 127.0.0.1 itself (not a name another
 * site could point at it), gets the status; Chromium's preflight for a public site asking the loopback address gets its
 * permission. Nothing here changes anything on the Pi.
 */
export async function respond(
  request: Request,
  options: Readonly<{ file: string; origin: string; port: number }>
): Promise<Response> {
  if (request.host !== `127.0.0.1:${options.port}`) return { code: 421, headers: {}, body: '' };
  const cors: Record<string, string> =
    request.origin === options.origin
      ? { 'Access-Control-Allow-Origin': options.origin, Vary: 'Origin' }
      : { Vary: 'Origin' };
  if (request.path !== '/status') return { code: 404, headers: cors, body: '' };
  if (request.method === 'OPTIONS') {
    return {
      code: 204,
      headers: {
        ...cors,
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '600'
      },
      body: ''
    };
  }
  if (request.method !== 'GET') return { code: 405, headers: { ...cors, Allow: 'GET, OPTIONS' }, body: '' };
  const status = await readStatus(options.file);
  return {
    code: 200,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(status)
  };
}
