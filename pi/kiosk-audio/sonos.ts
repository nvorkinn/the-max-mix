// Plays a Spotify song on a Sonos speaker with sonoscli (https://sonoscli.sh, installed by the playbook as SONOS_CLI).
// Spotify will not hand its playback to a Sonos from this app (the Web API hides Sonos as a restricted device), so the
// kiosk asks the speaker itself: `sonos open --name <room> <spotify uri>` finds the room on the home network, adds the
// song to that room's Sonos queue and plays it, through the Spotify account already linked in the Sonos app.
import { execFile } from 'node:child_process';

export const SONOS_CLI = '/usr/local/bin/sonos';
/** How long sonoscli may look for the speakers and talk to them; the process gets a little more. */
const CLI_TIMEOUT = '15s';
const PROCESS_TIMEOUT_MS = 25_000;
const MAX_NAME_LENGTH = 64;
const MAX_MESSAGE = 200;

/** What the app asks for: the Sonos room to play on and the Spotify item to play there. */
export interface SonosPlay {
  room: string;
  uri: string;
}

/** A Spotify id is 22 base-62 characters; sonoscli plays tracks, albums, playlists, shows and episodes. */
const SPOTIFY_URI = /^spotify:(track|album|playlist|show|episode):[0-9A-Za-z]{22}$/;
// A room name as the Sonos app shows it: printable, on one line, and not something sonoscli could read as a flag.
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const BAD_NAME = /[\u0000-\u001F\u007F]/;

/** The body of POST /sonos/play, or null when it is not one. */
export function parseSonosPlay(value: unknown): SonosPlay | null {
  if (typeof value !== 'object' || value === null) return null;
  const { room, uri } = value as Record<string, unknown>;
  if (typeof room !== 'string' || typeof uri !== 'string') return null;
  const name = room.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH || BAD_NAME.test(name) || name.startsWith('-')) return null;
  return SPOTIFY_URI.test(uri) ? { room: name, uri } : null;
}

/** The program and arguments that play it: no shell, the room as one --name=… argument and the URI after `--`. */
export const sonosCommand = ({ room, uri }: SonosPlay): string[] => [
  SONOS_CLI,
  'open',
  `--name=${room}`,
  `--timeout=${CLI_TIMEOUT}`,
  '--',
  uri
];

/** Why sonoscli failed, as one short line the app can show (it writes its reason to stderr, e.g. "speaker name not found"). */
export class SonosError extends Error {}

export function failureMessage(stderr: string): string {
  const line = stderr
    .split('\n')
    .map(text => text.replace(/^(Error|error):\s*/, '').trim())
    .find(Boolean);
  return line ? `Sonos: ${line.slice(0, MAX_MESSAGE)}` : 'Sonos did not start playing.';
}

export type RunCli = (argv: string[]) => Promise<{ code: number; stderr: string }>;

const runCli: RunCli = ([file = '', ...args]) =>
  new Promise(resolve => {
    // sonoscli keeps its settings and a cache of speaker names under the kiosk user's home.
    const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: process.env['HOME'] ?? '' };
    execFile(file, args, { env, timeout: PROCESS_TIMEOUT_MS }, (error, _stdout, stderr) => {
      if (!error) resolve({ code: 0, stderr });
      else if (error.code === 'ENOENT') resolve({ code: 127, stderr: 'sonoscli is not installed on this Pi yet.' });
      else if (error.killed) resolve({ code: 124, stderr: 'the speaker did not answer in time.' });
      else resolve({ code: typeof error.code === 'number' ? error.code : 1, stderr });
    });
  });

/** Plays the item on the room; rejects with a SonosError (a message safe to show) when sonoscli fails. */
export async function playOnSonos(request: SonosPlay, run: RunCli = runCli): Promise<void> {
  const { code, stderr } = await run(sonosCommand(request));
  if (code !== 0) {
    console.warn(`sonos: open on ${JSON.stringify(request.room)} failed (${code}): ${stderr.trim()}`);
    throw new SonosError(failureMessage(stderr));
  }
}
