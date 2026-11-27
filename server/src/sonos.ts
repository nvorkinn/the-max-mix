// The kiosk's Sonos speakers, through the Pi. Spotify will not hand its playback to a Sonos from this app (the Web API
// hides Sonos as a restricted device), so the kiosk asks the speakers themselves on the home network, with the
// @svrooij/sonos library (sonos-library.ts), and the song plays through the Spotify account linked in the Sonos app.
// The requests (server.ts) name rooms as the Sonos app does; this checks them and turns any failure into a SonosError
// whose message is safe to show.
import { library } from './sonos-library.ts';
import { NOW_NEXT, SonosError } from './sonos-shared.ts';
import type { SonosAction, SonosOperations } from './sonos-shared.ts';

export { SonosError } from './sonos-shared.ts';
export type { SonosOperations } from './sonos-shared.ts';

const MAX_NAME_LENGTH = 64;
const MAX_MESSAGE = 200;
const MAX_SONG_NAME = 500;

/** A Spotify id is 22 base-62 characters; Sonos plays tracks, albums, playlists, shows and episodes. */
const SPOTIFY_URI = /^spotify:(track|album|playlist|show|episode):[0-9A-Za-z]{22}$/;
// A room name as the Sonos app shows it: printable and on one line.
const BAD_NAME = /\p{Cc}/u;
const ACTIONS: ReadonlySet<unknown> = new Set<SonosAction>(['play', 'pause', 'next', 'previous', 'seek']);

/** The room name from a request, or null when it is not one. */
export function parseRoom(room: unknown): string | null {
  if (typeof room !== 'string') return null;
  const name = room.trim();
  const isBad = name.length === 0 || name.length > MAX_NAME_LENGTH || BAD_NAME.test(name) || name.startsWith('-');
  return isBad ? null : name;
}

/** At most this many songs are queued after the one played. */
const MAX_NEXT = 50;
const SPOTIFY_TRACK_URI = /^spotify:track:[0-9A-Za-z]{22}$/;

/** The songs to queue after the one played (Spotify track URIs), none when absent, or null when not a list of them. */
function parseNext(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_NEXT) return null;
  return value.every((entry): entry is string => typeof entry === 'string' && SPOTIFY_TRACK_URI.test(entry))
    ? value
    : null;
}

/** A position in a song, in ms, rounded; null when it is not one. */
const parsePosition = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;

/** A place among the songs queued next (GET /sonos/now lists at most NOW_NEXT of them), or null when it is not one. */
const parsePlace = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < NOW_NEXT ? value : null;

/** The body of POST /sonos/move, or null when it is not one. */
function parseMove(room: string, body: Record<string, unknown>): SonosRequest | null {
  const from = parsePlace(body['from']);
  const to = parsePlace(body['to']);
  const { name } = body;
  const isName = typeof name === 'string' && name.length > 0 && name.length <= MAX_SONG_NAME;
  return from !== null && to !== null && from !== to && isName ? { kind: 'move', room, from, to, name } : null;
}

/** The body of POST /sonos/play, or null when it is not one. */
function parsePlay(room: string, body: Record<string, unknown>): SonosRequest | null {
  const { uri, positionMs = 0 } = body;
  const next = parseNext(body['next']);
  const position = parsePosition(positionMs);
  // Moving from one Sonos group to another, the songs after it come from that group's queue.
  const queueFrom = body['queueFrom'] === undefined ? undefined : parseRoom(body['queueFrom']);
  const isPlayable =
    next && position !== null && queueFrom !== null && typeof uri === 'string' && SPOTIFY_URI.test(uri);
  return isPlayable ? { kind: 'play', room, uri, next, positionMs: position, ...(queueFrom && { queueFrom }) } : null;
}

/** One Sonos request from the app: which room, and what to do there. */
export type SonosRequest =
  | { kind: 'play'; room: string; uri: string; next: string[]; positionMs: number; queueFrom?: string }
  | { kind: 'control'; room: string; action: SonosAction; positionMs: number }
  | { kind: 'volume'; room: string; volume: number }
  | { kind: 'join'; room: string; to: string }
  | { kind: 'leave'; room: string }
  | { kind: 'move'; room: string; from: number; to: number; name: string };

/** The body of POST /sonos/<kind>, or null when it is not one. */
export function parseSonosRequest(kind: string, value: unknown): SonosRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;
  const room = parseRoom(body['room']);
  if (!room) return null;
  const { action, positionMs = 0, volume } = body;
  switch (kind) {
    case 'play': {
      return parsePlay(room, body);
    }
    case 'control': {
      const isAction = ACTIONS.has(action);
      const isPosition = typeof positionMs === 'number' && Number.isFinite(positionMs) && positionMs >= 0;
      return isAction && isPosition
        ? { kind, room, action: action as SonosAction, positionMs: Math.round(positionMs) }
        : null;
    }
    case 'volume': {
      const isVolume = typeof volume === 'number' && Number.isSafeInteger(volume) && volume >= 0 && volume <= 100;
      return isVolume ? { kind, room, volume } : null;
    }
    case 'join': {
      const to = parseRoom(body['to']);
      return to ? { kind, room, to } : null;
    }
    case 'leave': {
      return { kind, room };
    }
    case 'move': {
      return parseMove(room, body);
    }
    default: {
      return null;
    }
  }
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
export function guarded(operations: SonosOperations): SonosOperations {
  return {
    groups: wrap(operations.groups),
    play: wrap(operations.play),
    now: wrap(operations.now),
    upNext: wrap(operations.upNext),
    control: wrap(operations.control),
    volume: wrap(operations.volume),
    joinGroup: wrap(operations.joinGroup),
    leaveGroup: wrap(operations.leaveGroup),
    move: wrap(operations.move),
    art: wrap(operations.art)
  };
}

/** The library's calls, each rejecting only with a SonosError. */
export const sonos: SonosOperations = guarded(library);

/** Carries out a POST /sonos/… request; rejects with a SonosError (a message safe to show) when that fails. */
export async function runSonosRequest(request: SonosRequest, way: SonosOperations = sonos): Promise<void> {
  switch (request.kind) {
    case 'play': {
      const next = request.queueFrom ? await way.upNext(request.queueFrom, MAX_NEXT) : request.next;
      // So the log says what each room was given to play, and whether a queue came with it.
      const from = request.queueFrom ? `from ${request.queueFrom}'s queue` : 'from the tablet';
      console.info(`sonos: playing ${request.uri} on ${request.room}, ${next.length} songs after it ${from}`);
      await way.play(request.room, request.uri, next, request.positionMs);
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
    case 'move': {
      await way.move(request.room, request.from, request.to, request.name);
      break;
    }
    default: {
      await way.leaveGroup(request.room);
    }
  }
}
