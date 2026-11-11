// The shapes the app gets from Sonos, the calls sonos-library.ts answers (tests pass fakes), the error whose message is safe
// to show, and helpers for Sonos's own formats.

/** A Sonos room: its player id (RINCON_…) and its name. Requests name rooms by name, as the Sonos app shows them. */
interface SonosRoom {
  id: string;
  name: string;
}

/** A Sonos group on the home network: its id and its rooms, the one that leads it first. */
export interface SonosGroup {
  id: string;
  rooms: SonosRoom[];
}

/** What a Sonos group plays, as GET /sonos/now answers. */
interface SonosNowPlaying {
  /** Playing, or about to (TRANSITIONING); false when paused or stopped. */
  playing: boolean;
  positionMs: number;
  track: {
    name: string;
    artist?: string;
    album?: string;
    durationMs?: number;
    /** The Spotify URI, when the song comes from Spotify. */
    uri?: string;
    /** Whether GET /sonos/art has a picture for it. */
    art: boolean;
  } | null;
  /** The group's volume, 0 to 100; null when the speaker did not say. */
  volume: number | null;
  /** Whether the app may move the group to a point in the song. */
  canSeek: boolean;
}

export type SonosAction = 'play' | 'pause' | 'next' | 'previous' | 'seek';

/** A picture and its media type. */
export interface SonosArt {
  type: string;
  body: Buffer;
}

/** What the Pi can do with the household's speakers. Rooms are named as the Sonos app names them. */
export interface SonosOperations {
  groups: () => Promise<SonosGroup[]>;
  /**
   * Plays a Spotify item on the room's group, from the room's Sonos queue, with the songs in `next` queued after it,
   * from `positionMs` into it.
   */
  play: (room: string, uri: string, next: readonly string[], positionMs: number) => Promise<void>;
  now: (room: string) => Promise<SonosNowPlaying>;
  /** Plays, pauses, skips or (to positionMs) seeks on the room's group. */
  control: (room: string, action: SonosAction, positionMs: number) => Promise<void>;
  /** Sets the volume of the room's whole group, 0 to 100. */
  volume: (room: string, volume: number) => Promise<void>;
  /** Adds the room to the group that `to` is in. */
  joinGroup: (room: string, to: string) => Promise<void>;
  /** Takes the room out of its group; when it led the group, Sonos hands it to another room, which keeps playing. */
  leaveGroup: (room: string) => Promise<void>;
  /** The current song's artwork from the room's group, or null. */
  art: (room: string) => Promise<SonosArt | null>;
}

/** Why a Sonos call failed, as one short line the app can show (e.g. "Sonos: no room called Attic on this network."). */
export class SonosError extends Error {}

// Sonos names a Spotify song in its own way: "spotify:track:<id>", or that URI URL-encoded after "x-sonos-spotify:".
const SPOTIFY_TRACK = /spotify(?::|%3[aA])track(?::|%3[aA])([0-9A-Za-z]{22})/;

/** The Spotify track URI that Sonos's own name for a song holds, if any. */
export function spotifyTrackUri(...names: (string | undefined)[]): string | undefined {
  const id = SPOTIFY_TRACK.exec(names.join(' '))?.[1];
  return id && `spotify:track:${id}`;
}

/** "0:03:25" as milliseconds; undefined when it is not a time (e.g. "NOT_IMPLEMENTED"). */
export function parseTime(value = ''): number | undefined {
  const match = /^(\d+):(\d{2}):(\d{2})/.exec(value);
  if (!match) return undefined;
  const [, hours = '0', minutes = '0', seconds = '0'] = match;
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Milliseconds as the "h:mm:ss" a seek takes. */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 3600)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}

const MAX_ART_BYTES = 2_000_000;

/**
 * Fetches a song's artwork from a speaker, which serves it over plain HTTP on its own address. Only a picture from that
 * speaker (`origin`, e.g. "http://192.0.2.4:1400") is fetched; anything else, or a failed fetch, is null.
 */
export async function fetchArt(url: string, origin: string): Promise<SonosArt | null> {
  const resolved = new URL(url, origin);
  if (resolved.origin !== origin) return null;
  const response = await fetch(resolved, { signal: AbortSignal.timeout(5000) });
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.startsWith('image/')) return null;
  const body = Buffer.from(await response.arrayBuffer());
  return body.length <= MAX_ART_BYTES ? { type, body } : null;
}
