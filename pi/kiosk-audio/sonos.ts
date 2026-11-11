// Plays a Spotify song on a Sonos speaker. Spotify will not hand its playback to a Sonos from this app (the Web API hides
// Sonos as a restricted device), so the kiosk asks the speaker itself, through the Spotify account already linked in the
// Sonos app. Two ways to do that, picked in the app's settings while both are being tried:
//   cli      sonoscli (https://sonoscli.sh, installed by the playbook as SONOS_CLI): `sonos open --name <room> <uri>`
//            finds the room on the home network, adds the song to that room's Sonos queue and plays it.
//   library  the @svrooij/sonos library (sonos-library.ts), which does the same from this process.
// POST /sonos/test runs one of two calls that only resume what the speaker has, without naming a song, to see what they do:
//   cli-play         `sonos play --name <room>`       library-queue    SwitchToQueue() then Play() on the room's group
import { execFile } from 'node:child_process';
import { playWithLibrary, resumeQueue } from './sonos-library.ts';

const SONOS_CLI = '/usr/local/bin/sonos';
/** How long sonoscli may look for the speakers and talk to them; the process gets a little more. */
const CLI_TIMEOUT = '15s';
const PROCESS_TIMEOUT_MS = 25_000;
const MAX_NAME_LENGTH = 64;
const MAX_MESSAGE = 200;

type SonosEngine = 'cli' | 'library';
export type SonosTest = 'cli-play' | 'library-queue';

/** What the app asks for: the Sonos room to play on, the Spotify item to play there, and which way to ask. */
export interface SonosPlay {
  room: string;
  uri: string;
  engine: SonosEngine;
}

/** A Spotify id is 22 base-62 characters; both ways play tracks, albums, playlists, shows and episodes. */
const SPOTIFY_URI = /^spotify:(track|album|playlist|show|episode):[0-9A-Za-z]{22}$/;
// A room name as the Sonos app shows it: printable, on one line, and not something sonoscli could read as a flag.
const BAD_NAME = /\p{Cc}/u;

/** The room name from a request, or null when it is not one. */
function parseRoom(room: unknown): string | null {
  if (typeof room !== 'string') return null;
  const name = room.trim();
  const isBad = name.length === 0 || name.length > MAX_NAME_LENGTH || BAD_NAME.test(name) || name.startsWith('-');
  return isBad ? null : name;
}

/** The body of POST /sonos/play, or null when it is not one. sonoscli is the default way. */
export function parseSonosPlay(value: unknown): SonosPlay | null {
  if (typeof value !== 'object' || value === null) return null;
  const { room, uri, engine = 'cli' } = value as Record<string, unknown>;
  const name = parseRoom(room);
  if (!name || typeof uri !== 'string' || !SPOTIFY_URI.test(uri)) return null;
  return engine === 'cli' || engine === 'library' ? { room: name, uri, engine } : null;
}

/** The body of POST /sonos/test, or null when it is not one. */
export function parseSonosTest(value: unknown): { room: string; test: SonosTest } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { room, test } = value as Record<string, unknown>;
  const name = parseRoom(room);
  return name && (test === 'cli-play' || test === 'library-queue') ? { room: name, test } : null;
}

/** The program and arguments that play it: no shell, the room as one --name=… argument and the URI after `--`. */
export const sonosCommand = ({ room, uri }: Pick<SonosPlay, 'room' | 'uri'>): string[] => [
  SONOS_CLI,
  'open',
  `--name=${room}`,
  `--timeout=${CLI_TIMEOUT}`,
  '--',
  uri
];

/** `sonos play`: resume whatever the room's group has loaded. */
export const resumeCommand = (room: string): string[] => [
  SONOS_CLI,
  'play',
  `--name=${room}`,
  `--timeout=${CLI_TIMEOUT}`
];

/** Why it failed, as one short line the app can show (e.g. sonoscli's "speaker name not found"). */
export class SonosError extends Error {}

export function failureMessage(stderr: string): string {
  const line = stderr
    .split('\n')
    .map(text => text.replace(/^(Error|error):\s*/, '').trim())
    .find(Boolean);
  return line ? `Sonos: ${line.slice(0, MAX_MESSAGE)}` : 'Sonos did not start playing.';
}

type RunCli = (argv: string[]) => Promise<{ code: number; stderr: string }>;

const runCli: RunCli = ([file = '', ...args]) =>
  new Promise(resolve => {
    // sonoscli keeps its settings and a cache of speaker names under the kiosk user's home.
    const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: process.env['HOME'] ?? '' };
    // The caller passes SONOS_CLI, an absolute path; PATH is only passed on.
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    execFile(file, args, { env, timeout: PROCESS_TIMEOUT_MS }, (error, _stdout, stderr) => {
      if (!error) resolve({ code: 0, stderr });
      else if (error.code === 'ENOENT') resolve({ code: 127, stderr: 'sonoscli is not installed on this Pi yet.' });
      else if (error.killed) resolve({ code: 124, stderr: 'the speaker did not answer in time.' });
      else resolve({ code: typeof error.code === 'number' ? error.code : 1, stderr });
    });
  });

/** What playing needs: sonoscli, and the library's two calls. Tests pass fakes. */
export interface SonosWays {
  run: RunCli;
  play: (room: string, uri: string) => Promise<void>;
  resume: (room: string) => Promise<void>;
}

const WAYS: SonosWays = { run: runCli, play: playWithLibrary, resume: resumeQueue };

async function runOrFail(argv: string[], room: string, ways: SonosWays): Promise<void> {
  const { code, stderr } = await ways.run(argv);
  if (code === 0) return;
  console.warn(`sonos: ${argv[1] ?? ''} on ${JSON.stringify(room)} failed (${code}): ${stderr.trim()}`);
  throw new SonosError(failureMessage(stderr));
}

/** Runs one of the library's calls; a failure becomes a SonosError with its message. */
async function libraryOrFail(call: () => Promise<void>, room: string): Promise<void> {
  try {
    await call();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`sonos: library call on ${JSON.stringify(room)} failed: ${message}`);
    throw new SonosError(`Sonos: ${message.slice(0, MAX_MESSAGE)}`, { cause: error });
  }
}

/** Plays the item on the room; rejects with a SonosError (a message safe to show) when that fails. */
export async function playOnSonos(request: SonosPlay, ways: SonosWays = WAYS): Promise<void> {
  if (request.engine === 'library') await libraryOrFail(() => ways.play(request.room, request.uri), request.room);
  else await runOrFail(sonosCommand(request), request.room, ways);
}

/** Runs one of the test calls on the room; rejects with a SonosError when it fails. */
export async function testOnSonos(room: string, test: SonosTest, ways: SonosWays = WAYS): Promise<void> {
  if (test === 'library-queue') await libraryOrFail(() => ways.resume(room), room);
  else await runOrFail(resumeCommand(room), room, ways);
}
