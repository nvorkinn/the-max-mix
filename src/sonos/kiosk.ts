// The kiosk's Sonos speakers, through the Pi's local service (pi/kiosk-audio/sonos.ts), which talks to them on the home
// network. Spotify will not move its playback to a Sonos from this app (the Web API hides Sonos as a restricted device),
// so the Pi starts the song on the speaker itself: it goes into the room's Sonos queue and plays through the Spotify
// account linked in the Sonos app. The Pi does that, and everything else here, with the sonos-ts library. Rooms are named
// as the Sonos app names them.
import { errorMessage } from '../utils/errorMessage';
import { KIOSK_SERVICE } from '../utils/kioskService';

// Finding the speakers on the home network can take the Pi a few seconds; a call may then wait on a slow speaker.
const TIMEOUT_MS = 30_000;

export type SonosAction = 'play' | 'pause' | 'next' | 'previous' | 'seek';

// The room leading the Sonos group the kiosk last started a song on, by name, for this page's life. While it is set the
// drawer marks that group's rooms (SonosKioskList) and the tablet shows and controls the group (useSonosPlayer).
let kioskLeader: string | null = null;
const leaderListeners = new Set<() => void>();

export const getKioskSonosLeader = (): string | null => kioskLeader;

export function setKioskSonosLeader(room: string | null): void {
  if (room === kioskLeader) return;
  kioskLeader = room;
  for (const listener of leaderListeners) listener();
}

/** Calls `listener` each time the leading room changes; returns how to stop. */
export function subscribeKioskSonosLeader(listener: () => void): () => void {
  leaderListeners.add(listener);
  return () => {
    leaderListeners.delete(listener);
  };
}

/** Asks the Pi; the answer when it is OK, else an Error with a message to show. */
async function ask(path: string, init: RequestInit, refused: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${KIOSK_SERVICE}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new Error(`The kiosk’s audio service did not answer: ${errorMessage(error)}`, { cause: error });
  }
  if (response.ok) return response;
  if (response.status === 400) throw new Error(refused);
  if (response.status === 404) throw new Error('This Pi can’t do that with Sonos yet. Update it in Settings.');
  const reply = (await response.json().catch(() => null)) as { error?: unknown } | null;
  throw new Error(typeof reply?.error === 'string' ? reply.error : `Sonos did not do that (${response.status}).`);
}

async function post(path: string, body: Record<string, unknown>, refused = 'Sonos can’t do that.'): Promise<void> {
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
  await ask(path, init, refused);
}

const query = (values: Record<string, string>) => new URLSearchParams(values);

/** A Sonos room as the Pi finds it: its player id and its name. */
export interface PiSonosRoom {
  id: string;
  name: string;
}

/** A Sonos group as the Pi finds it: its id and its rooms, the one that leads it first. */
export interface PiSonosGroup {
  id: string;
  rooms: PiSonosRoom[];
}

/** What a Sonos group plays, as the Pi says. */
export interface PiSonosNow {
  playing: boolean;
  positionMs: number;
  track: {
    name: string;
    artist?: string;
    album?: string;
    durationMs?: number;
    uri?: string;
    /** Whether the Pi has a picture for it (getSonosArt). */
    art: boolean;
  } | null;
  volume: number | null;
  /** Whether the group can be moved to a point in the song. */
  canSeek: boolean;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

function parseGroups(value: unknown): PiSonosGroup[] {
  const groups = record(value)['groups'];
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((entry: unknown): PiSonosGroup[] => {
    const { id, rooms } = record(entry);
    const found = (Array.isArray(rooms) ? rooms : []).flatMap((room: unknown): PiSonosRoom[] => {
      const roomId = text(record(room)['id']);
      const name = text(record(room)['name']);
      return roomId && name ? [{ id: roomId, name }] : [];
    });
    return typeof id === 'string' && found.length > 0 ? [{ id, rooms: found }] : [];
  });
}

function parseNow(value: unknown): PiSonosNow {
  const reply = record(value);
  const track = record(reply['track']);
  const name = text(track['name']);
  const artist = text(track['artist']);
  const album = text(track['album']);
  const durationMs = count(track['durationMs']);
  const uri = text(track['uri']);
  return {
    playing: reply['playing'] === true,
    positionMs: count(reply['positionMs']) ?? 0,
    track: name
      ? {
          name,
          ...(artist && { artist }),
          ...(album && { album }),
          ...(durationMs && { durationMs }),
          ...(uri && { uri }),
          art: track['art'] === true
        }
      : null,
    volume: count(reply['volume']) ?? null,
    canSeek: reply['canSeek'] === true
  };
}

/**
 * The Sonos groups on the home network, found by the Pi, and how long the Pi took
 * to find them; rejects with a message to show when it could not.
 */
export async function findSonosOnPi(): Promise<{ groups: PiSonosGroup[]; ms: number }> {
  const response = await ask('/sonos/groups', {}, 'Sonos speakers not found.');
  const reply: unknown = await response.json();
  return { groups: parseGroups(reply), ms: count(record(reply)['ms']) ?? 0 };
}

/** What the room's group plays. */
export async function getSonosNow(room: string): Promise<PiSonosNow> {
  const response = await ask(`/sonos/now?${query({ room })}`, {}, 'Sonos can’t say what plays there.');
  return parseNow(await response.json());
}

/** The current song's artwork from the room's group, as a blob; null when there is none. */
export async function getSonosArt(room: string): Promise<Blob | null> {
  try {
    const response = await ask(`/sonos/art?${query({ room })}`, {}, '');
    return await response.blob();
  } catch {
    return null;
  }
}

/** At most this many songs are sent to queue after the one played (the Pi takes 50). */
const MAX_NEXT = 50;
const SPOTIFY_TRACK_URI = /^spotify:track:[0-9A-Za-z]{22}$/;

/**
 * Plays the Spotify item (a spotify: URI) on the Sonos room, with the songs in `next` queued after it (only Spotify
 * songs are kept, at most 50), from `positionMs` into it; rejects with a message to show when it could not. With
 * `queueFrom`, a Sonos room, the songs queued after the one that room's group plays are queued instead.
 */
export function playOnSonosRoom(
  room: string,
  uri: string,
  {
    next = [],
    positionMs = 0,
    queueFrom
  }: { next?: readonly string[]; positionMs?: number; queueFrom?: string | null } = {}
): Promise<void> {
  const songs = next.filter(song => SPOTIFY_TRACK_URI.test(song)).slice(0, MAX_NEXT);
  const body = {
    room,
    uri,
    ...(songs.length > 0 && { next: songs }),
    ...(positionMs > 0 && { positionMs: Math.round(positionMs) }),
    ...(queueFrom && { queueFrom })
  };
  return post('/sonos/play', body, 'This song can’t be played on Sonos.');
}

/** Plays, pauses, skips or (to positionMs) seeks on the room's group. */
export function controlSonos(room: string, action: SonosAction, positionMs = 0): Promise<void> {
  return post('/sonos/control', { room, action, ...(action === 'seek' && { positionMs: Math.round(positionMs) }) });
}

/** Sets the volume of the room's whole group, 0 to 100. */
export function setSonosVolume(room: string, volume: number): Promise<void> {
  const level = Math.min(100, Math.max(0, volume));
  return post('/sonos/volume', { room, volume: Math.round(level) });
}

/** Adds the room to the group that `to` is in. */
export function joinSonosGroup(room: string, to: string): Promise<void> {
  return post('/sonos/join', { room, to });
}

/** Takes the room out of its group; when it led the group, Sonos hands it to another room, which keeps playing. */
export function leaveSonosGroup(room: string): Promise<void> {
  return post('/sonos/leave', { room });
}

/** What changed on the speakers: the rooms' grouping, or what a group plays (song, play or pause, volume). */
export type SonosChange = 'groups' | 'now';

interface SonosWatcher {
  onChange: (change: SonosChange) => void;
  /** Whether the Pi is sending changes now; while not, the caller keeps reading on its own. */
  onLive?: ((live: boolean) => void) | undefined;
}

// One stream from the Pi (GET /sonos/events) for the whole page, open while anything watches.
const watchers = new Set<SonosWatcher>();
let stream: EventSource | null = null;
let isLive = false;

function setLive(live: boolean): void {
  if (live === isLive) return;
  isLive = live;
  for (const watcher of watchers) watcher.onLive?.(live);
}

function openStream(): EventSource {
  const source = new EventSource(`${KIOSK_SERVICE}/sonos/events`);
  source.addEventListener('open', () => setLive(true));
  // The browser tries again by itself after a dropped stream; a Pi without the stream (404) ends it for good.
  source.addEventListener('error', () => setLive(false));
  source.addEventListener('message', (event: MessageEvent<string>) => {
    let kind: unknown;
    try {
      kind = record(JSON.parse(event.data))['kind'];
    } catch {
      return;
    }
    if (kind !== 'groups' && kind !== 'now') return;
    for (const watcher of watchers) watcher.onChange(kind);
  });
  return source;
}

/**
 * Calls `onChange` each time the Pi says the speakers changed, and `onLive` when that stream starts or stops; returns how
 * to stop watching. The Pi only says what kind of thing changed: read it with findSonosOnPi or getSonosNow.
 */
export function watchSonosOnPi(onChange: (change: SonosChange) => void, onLive?: (live: boolean) => void): () => void {
  const watcher: SonosWatcher = { onChange, onLive };
  watchers.add(watcher);
  // Without EventSource (tests, very old browsers) the callers simply keep reading on their own.
  if (typeof EventSource !== 'undefined') stream ??= openStream();
  if (isLive) onLive?.(true);
  return () => {
    watchers.delete(watcher);
    if (!stream || watchers.size > 0) return;
    stream.close();
    stream = null;
    isLive = false;
  };
}
