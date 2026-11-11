// The kiosk's Sonos speakers, through the Pi. Spotify will not hand its playback to a Sonos from this app (the Web API
// hides Sonos as a restricted device), so the kiosk asks the speakers themselves on the home network, and the song plays
// through the Spotify account linked in the Sonos app. Two ways to talk to them, picked in the app's settings while
// both are being tried; each request names its way:
//   cli      sonoscli (sonos-cli.ts): runs `sonos …` once per call.
//   library  the @svrooij/sonos library (sonos-library.ts), from this process.
// The requests (server.ts) name rooms as the Sonos app does; this checks them and turns any failure into a SonosError
// whose message is safe to show. POST /sonos/test runs one of two calls that only resume what the speaker has, without
// naming a song, to see what they do:
//   cli-play         `sonos play --name <room>`       library-queue    SwitchToQueue() then Play() on the room's group
import { cliOperations, resumeCommand, runCli, runOrFail } from './sonos-cli.ts';
import type { RunCli } from './sonos-cli.ts';
import { library, resumeQueue } from './sonos-library.ts';
import { SonosError } from './sonos-shared.ts';
import type { SonosAction, SonosEngine, SonosOperations } from './sonos-shared.ts';

export { SonosError } from './sonos-shared.ts';
export type { SonosAction, SonosEngine, SonosGroup, SonosNowPlaying, SonosOperations } from './sonos-shared.ts';

const MAX_NAME_LENGTH = 64;
const MAX_MESSAGE = 200;

export type SonosTest = 'cli-play' | 'library-queue';

/** A Spotify id is 22 base-62 characters; both ways play tracks, albums, playlists, shows and episodes. */
const SPOTIFY_URI = /^spotify:(track|album|playlist|show|episode):[0-9A-Za-z]{22}$/;
// A room name as the Sonos app shows it: printable, on one line, and not something sonoscli could read as a flag.
const BAD_NAME = /\p{Cc}/u;
const ACTIONS: ReadonlySet<unknown> = new Set<SonosAction>(['play', 'pause', 'next', 'previous', 'seek']);

/** The room name from a request, or null when it is not one. */
export function parseRoom(room: unknown): string | null {
  if (typeof room !== 'string') return null;
  const name = room.trim();
  const isBad = name.length === 0 || name.length > MAX_NAME_LENGTH || BAD_NAME.test(name) || name.startsWith('-');
  return isBad ? null : name;
}

/** The way a request names, sonoscli when none; null when it names neither. */
export function parseEngine(value: unknown): SonosEngine | null {
  if ([undefined, null, 'cli'].includes(value as string | null | undefined)) return 'cli';
  return value === 'library' ? 'library' : null;
}

/** One Sonos request from the app: which way, which room, and what to do there. */
export type SonosRequest =
  | { kind: 'play'; engine: SonosEngine; room: string; uri: string }
  | { kind: 'control'; engine: SonosEngine; room: string; action: SonosAction; positionMs: number }
  | { kind: 'volume'; engine: SonosEngine; room: string; volume: number }
  | { kind: 'join'; engine: SonosEngine; room: string; to: string }
  | { kind: 'leave'; engine: SonosEngine; room: string };

/** The body of POST /sonos/<kind>, or null when it is not one. */
export function parseSonosRequest(kind: string, value: unknown): SonosRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;
  const engine = parseEngine(body['engine']);
  const room = parseRoom(body['room']);
  if (!engine || !room) return null;
  const { uri, action, positionMs = 0, volume } = body;
  switch (kind) {
    case 'play': {
      return typeof uri === 'string' && SPOTIFY_URI.test(uri) ? { kind, engine, room, uri } : null;
    }
    case 'control': {
      const isAction = ACTIONS.has(action);
      const isPosition = typeof positionMs === 'number' && Number.isFinite(positionMs) && positionMs >= 0;
      return isAction && isPosition
        ? { kind, engine, room, action: action as SonosAction, positionMs: Math.round(positionMs) }
        : null;
    }
    case 'volume': {
      const isVolume = typeof volume === 'number' && Number.isSafeInteger(volume) && volume >= 0 && volume <= 100;
      return isVolume ? { kind, engine, room, volume } : null;
    }
    case 'join': {
      const to = parseRoom(body['to']);
      return to ? { kind, engine, room, to } : null;
    }
    case 'leave': {
      return { kind, engine, room };
    }
    default: {
      return null;
    }
  }
}

/** The body of POST /sonos/test, or null when it is not one. */
export function parseSonosTest(value: unknown): { room: string; test: SonosTest } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { room, test } = value as Record<string, unknown>;
  const name = parseRoom(room);
  return name && (test === 'cli-play' || test === 'library-queue') ? { room: name, test } : null;
}

/** A failure as a SonosError: its own message when it is one, else "Sonos: " and the library's reason. */
function asSonosError(error: unknown): SonosError {
  if (error instanceof SonosError) return error;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`sonos: library call failed: ${message}`);
  return new SonosError(`Sonos: ${message.slice(0, MAX_MESSAGE)}`, { cause: error });
}

/** The call, rejecting only with a SonosError. */
const wrap =
  <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
  async (...args: A): Promise<R> => {
    try {
      return await call(...args);
    } catch (error) {
      throw asSonosError(error);
    }
  };

/** Every call of `operations`, rejecting only with a SonosError. */
function guarded(operations: SonosOperations): SonosOperations {
  return {
    groups: wrap(operations.groups),
    play: wrap(operations.play),
    now: wrap(operations.now),
    control: wrap(operations.control),
    volume: wrap(operations.volume),
    joinGroup: wrap(operations.joinGroup),
    leaveGroup: wrap(operations.leaveGroup),
    art: wrap(operations.art)
  };
}

/** The two ways, and the library's resume call for the test buttons. Tests pass fakes. */
export interface SonosWays {
  cli: SonosOperations;
  library: SonosOperations;
  run: RunCli;
  resume: (room: string) => Promise<void>;
}

const WAYS: SonosWays = { cli: cliOperations(runCli), library, run: runCli, resume: resumeQueue };

/** The calls of the chosen way, each rejecting only with a SonosError. */
export function sonosWay(engine: SonosEngine, ways: SonosWays = WAYS): SonosOperations {
  return guarded(ways[engine]);
}

/** Carries out a POST /sonos/… request; rejects with a SonosError (a message safe to show) when that fails. */
export async function runSonosRequest(request: SonosRequest, ways: SonosWays = WAYS): Promise<void> {
  const way = sonosWay(request.engine, ways);
  switch (request.kind) {
    case 'play': {
      await way.play(request.room, request.uri);
      break;
    }
    case 'control': {
      await way.control(request.room, request.action, request.positionMs);
      break;
    }
    case 'volume': {
      await way.volume(request.room, request.volume);
      break;
    }
    case 'join': {
      await way.joinGroup(request.room, request.to);
      break;
    }
    default: {
      await way.leaveGroup(request.room);
    }
  }
}

/** Runs one of the test calls on the room; rejects with a SonosError when it fails. */
export async function testOnSonos(room: string, test: SonosTest, ways: SonosWays = WAYS): Promise<void> {
  try {
    if (test === 'library-queue') await ways.resume(room);
    else await runOrFail(ways.run, resumeCommand(room));
  } catch (error) {
    throw asSonosError(error);
  }
}
