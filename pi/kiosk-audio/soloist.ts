// Spotify Soloist's API key (POST /soloist/key). Soloist, Spotify's headless Spotify Connect player, runs as the kiosk
// user's kiosk-soloist.service and won't start without its API key on the Pi. The key is countdown-server's secret (no
// release carries it), so the app fetches it with the device secret and hands it here. This stores it with
// `soloist setup-api-key` (on standard input, never in a command line) in the player's state folder, and restarts the
// player. It notes only a digest of the key it stored, so the same key again changes nothing; a new one replaces it.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Absolute paths, so nothing on PATH can stand in for them.
export const SOLOIST = '/usr/local/bin/soloist';
export const SYSTEMCTL = '/usr/bin/systemctl';
const UNIT = 'kiosk-soloist.service';
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_KEY = 512;

/** The key in the body of POST /soloist/key, `{"api_key": "..."}`, or null when it is not one. */
export function validSoloistKey(body: unknown): string | null {
  const key = (body as { api_key?: unknown } | null)?.api_key;
  return typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY && /^[\x21-\x7E]+$/.test(key) ? key : null;
}

export type RunWithInput = (
  argv: string[],
  input: string,
  env: NodeJS.ProcessEnv
) => Promise<{ code: number; stderr: string }>;

/** Runs a program without a shell, with `input` on its standard input. 124 means it timed out, 127 that it didn't start. */
export const runWithInput: RunWithInput = ([file = '', ...args], input, env) =>
  new Promise(resolve => {
    const child = execFile(
      // Callers pass absolute paths (SOLOIST, SYSTEMCTL), so PATH is never searched.
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      file,
      args,
      { env, timeout: COMMAND_TIMEOUT_MS, encoding: 'utf8' },
      (error, _stdout, stderr) => {
        if (!error) resolve({ code: 0, stderr });
        else if (typeof error.code === 'number') resolve({ code: error.code, stderr });
        else resolve({ code: error.killed ? 124 : 127, stderr: stderr || error.message });
      }
    );
    child.stdin?.end(input);
  });

export interface SoloistKeyOptions {
  /** The player's state folder (kiosk-soloist.service's StateDirectory=), where Soloist keeps the key. */
  stateDir: string;
  /** Where the digest of the last key stored is noted. */
  digestFile: string;
  run?: RunWithInput;
}

async function hasCredentials(stateDir: string): Promise<boolean> {
  try {
    return (await readdir(path.join(stateDir, 'credentials'))).length > 0;
  } catch {
    return false;
  }
}

async function readText(file: string): Promise<string> {
  try {
    return (await readFile(file, 'utf8')).trim();
  } catch {
    return '';
  }
}

/** Stores `key` for the player and restarts it; 'unchanged' when that key is already stored. Rejects when it could not. */
export async function storeSoloistKey(
  key: string,
  { stateDir, digestFile, run = runWithInput }: SoloistKeyOptions
): Promise<'stored' | 'unchanged'> {
  const digest = createHash('sha256').update(key).digest('hex');
  if ((await readText(digestFile)) === digest && (await hasCredentials(stateDir))) return 'unchanged';
  await mkdir(stateDir, { recursive: true });
  const env: NodeJS.ProcessEnv = { LC_ALL: 'C', STATE_DIRECTORY: stateDir };
  const runtime = process.env['XDG_RUNTIME_DIR'];
  if (runtime) env['XDG_RUNTIME_DIR'] = runtime;
  // The player locks its state folder while it runs, so it stops while the key is written.
  await run([SYSTEMCTL, '--user', 'stop', UNIT], '', env);
  const stored = await run([SOLOIST, 'setup-api-key'], `${key}\n`, env);
  if (stored.code !== 0) {
    // Soloist's own words only, which don't carry the key.
    throw new Error(`soloist setup-api-key failed (${stored.code}): ${stored.stderr.trim().slice(0, 200)}`);
  }
  await mkdir(path.dirname(digestFile), { recursive: true });
  await writeFile(digestFile, `${digest}\n`, { mode: 0o600 });
  const started = await run([SYSTEMCTL, '--user', 'start', UNIT], '', env);
  if (started.code !== 0) throw new Error(`Soloist did not start (${started.code}): ${started.stderr.trim()}`);
  return 'stored';
}
