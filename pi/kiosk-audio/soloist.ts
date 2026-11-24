// Spotify Soloist, Spotify's headless Spotify Connect player, run by this service for whoever is active on the kiosk.
// Every person has their own Soloist API key (Spotify's terms: a key is its maker's alone), which countdown-server keeps
// by Spotify ID. The app says who is active (POST /soloist/person), with the device secret; this fetches that person's
// key from countdown-server (its key route answers no web page, on purpose), holds it in memory only, and runs Soloist
// with it and the person's own data folder, where Soloist keeps their Spotify session. The key is fetched again at every
// start, so a replaced key takes effect. Soloist takes the key on its command line, so its command is never logged.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// An absolute path, so nothing on PATH can stand in for it. kiosk-soloist-update installs it.
const SOLOIST = '/usr/local/bin/soloist';
const DEVICE_NAME = 'The Max Mix Soloist';
const CACHE_MB = '200';
// Its WebSocket API, which soloist-socket.ts joins to the app.
const SOLOIST_WS = '127.0.0.1:7342';
// Soloist's exit code for a build past its 90 days: kiosk-soloist-update fetches the next one.
const EXPIRED = 10;
const RESTART_MS = 10_000;
const EXPIRED_RETRY_MS = 60 * 60_000;
const STOP_MS = 5000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_TEXT = 512;

/** Who Soloist plays for, and how to ask countdown-server for their key. */
export interface SoloistRequest {
  /** Their Spotify user ID, which names their key on countdown-server and their data folder here. */
  person: string;
  /** countdown-server's API origin. */
  server: string;
  /** The device secret. */
  secret: string;
}

/** Printable ASCII without spaces, as keys and secrets are. */
function isToken(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index) ?? 0;
    if (code <= 0x20 || code > 0x7e) return false;
  }
  return true;
}

/** The body of POST /soloist/person as a request, or null when it is not one. */
export function validSoloistRequest(body: unknown): SoloistRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const { person, server, secret } = body as Record<string, unknown>;
  // A Spotify ID, which also names a folder: letters, digits, '.', '_' and '-', not starting with a dot.
  if (typeof person !== 'string' || !/^[\w-][\w.-]{0,127}$/.test(person)) return null;
  if (typeof server !== 'string' || !isToken(secret)) return null;
  let url: URL;
  try {
    url = new URL(server);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  return { person, server: url.origin, secret };
}

/** What fetching a person's key gave: the key, or why there is none. */
export type KeyResult = { key: string } | { error: 'no-key' | 'not-paired' | 'unknown-device' | 'failed' };
export type FetchKey = (request: SoloistRequest) => Promise<KeyResult>;

/** Asks countdown-server for the person's key (GET /api/devices/soloist/key?person=…). */
export const fetchSoloistKey: FetchKey = async ({ person, server, secret }) => {
  const url = new URL('/api/devices/soloist/key', server);
  url.searchParams.set('person', person);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (response.status === 404) return { error: 'no-key' };
    if (response.status === 409) return { error: 'not-paired' };
    if (response.status === 401) return { error: 'unknown-device' };
    if (!response.ok) return { error: 'failed' };
    const key = ((await response.json()) as { api_key?: unknown } | null)?.api_key;
    return isToken(key) ? { key } : { error: 'failed' };
  } catch {
    return { error: 'failed' };
  }
};

type Spawn = (args: string[]) => ChildProcess;

const spawnSoloist: Spawn = args =>
  // Soloist's own lines go to this service's journal; its command line, which holds the key, is never printed.
  spawn(SOLOIST, args, { stdio: ['ignore', 'inherit', 'inherit'] });

export type SoloistState =
  'stopped' | 'starting' | 'playing' | 'no-key' | 'not-paired' | 'unknown-device' | 'failed' | 'expired';

interface SoloistOptions {
  /** The folder that holds a data folder per person. */
  stateDir: string;
  fetchKey?: FetchKey;
  spawn?: Spawn;
  restartMs?: number;
  log?: (line: string) => void;
}

const sameRequest = (a: SoloistRequest | null, b: SoloistRequest) =>
  a?.person === b.person && a.server === b.server && a.secret === b.secret;

/** Runs one Soloist at a time, for the person last asked for, and starts it again when it stops. */
export class SoloistPlayer {
  readonly #stateDir: string;
  readonly #fetchKey: FetchKey;
  readonly #spawn: Spawn;
  readonly #restartMs: number;
  readonly #log: (line: string) => void;
  #request: SoloistRequest | null = null;
  #child: ChildProcess | null = null;
  #state: SoloistState = 'stopped';
  #timer: ReturnType<typeof setTimeout> | undefined;
  // Bumped by every change of person, so a start that was overtaken drops what it fetched.
  #generation = 0;

  constructor(options: SoloistOptions) {
    this.#stateDir = options.stateDir;
    this.#fetchKey = options.fetchKey ?? fetchSoloistKey;
    this.#spawn = options.spawn ?? spawnSoloist;
    this.#restartMs = options.restartMs ?? RESTART_MS;
    this.#log = options.log ?? (line => console.info(line));
  }

  #later(ms: number): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#start(), ms);
  }

  async #start(): Promise<SoloistState> {
    const generation = ++this.#generation;
    const request = this.#request;
    if (!request) return this.#state;
    this.#state = 'starting';
    const result = await this.#fetchKey(request);
    if (generation !== this.#generation) return this.#state;
    if ('error' in result) {
      this.#state = result.error;
      this.#log(`Soloist: no key for ${request.person} (${result.error})`);
      if (result.error === 'failed') this.#later(this.#restartMs);
      return this.#state;
    }
    const dataDir = path.join(this.#stateDir, 'people', request.person);
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    if (generation !== this.#generation) return this.#state;
    const child = this.#spawn([
      '--device-name',
      DEVICE_NAME,
      '--cache-size',
      CACHE_MB,
      '--ws',
      SOLOIST_WS,
      '--data-dir',
      dataDir,
      '--api-key',
      result.key
    ]);
    this.#child = child;
    this.#state = 'playing';
    this.#log(`Soloist: started for ${request.person}`);
    const ended = (code: number | null) => {
      if (this.#child !== child) return;
      this.#child = null;
      if (code === EXPIRED) {
        this.#state = 'expired';
        this.#log('Soloist: this build has expired; trying again once a new one is installed');
        this.#later(EXPIRED_RETRY_MS);
      } else {
        this.#state = 'failed';
        this.#log(`Soloist: stopped (${String(code)}), starting it again`);
        this.#later(this.#restartMs);
      }
    };
    child.on('exit', ended);
    child.on('error', () => {
      ended(null);
    });
    return this.#state;
  }

  async #stopChild(): Promise<void> {
    clearTimeout(this.#timer);
    const child = this.#child;
    this.#child = null;
    if (!child || child.exitCode !== null) return;
    const exited = new Promise<void>(resolve => {
      child.once('exit', () => {
        resolve();
      });
    });
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), STOP_MS);
    await exited;
    clearTimeout(timer);
  }

  get state(): SoloistState {
    return this.#state;
  }

  /** Runs Soloist for `request.person`: nothing changes while it already plays for them. Resolves with the state. */
  async play(request: SoloistRequest): Promise<SoloistState> {
    if (sameRequest(this.#request, request) && (this.#state === 'playing' || this.#state === 'starting')) {
      return this.#state;
    }
    this.#request = request;
    this.#generation += 1;
    await this.#stopChild();
    return this.#start();
  }

  /** Stops Soloist until someone is asked for again. */
  async stop(): Promise<void> {
    this.#request = null;
    this.#generation += 1;
    await this.#stopChild();
    this.#state = 'stopped';
  }
}
