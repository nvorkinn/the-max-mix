// The Sonos Control API calls the app makes, through the app's relay (api/sonos-control.ts). Replies are untrusted JSON:
// each parser keeps the fields it knows when they have the right type.

import { recordOf } from '../spotify/parse';
import type { SpotifyDevice } from '../types';
import { discardSonosAccessToken, getSonosAccessToken } from './auth';

const RELAY = '/api/sonos-control';

/** A Sonos group: one room, or rooms grouped in the Sonos app. It plays as one speaker. */
export interface SonosGroup {
  id: string;
  /** What the Sonos app calls the group, e.g. "Kitchen" or "Kitchen + 1". */
  name: string;
  /** The rooms in the group, the coordinator (the room that leads it) first. */
  rooms: string[];
  householdId: string;
  /** The group's players (one per room), the coordinator first. */
  playerIds: string[];
  /** Whether Sonos says the group is playing right now. */
  playing: boolean;
}

/** One Sonos room (player) that can join a group. */
export interface SonosRoom {
  id: string;
  name: string;
  householdId: string;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const token = await getSonosAccessToken();
  if (!token) throw new Error('Sign in to Sonos in Settings.');
  return fetch(`${RELAY}?${new URLSearchParams({ path })}`, {
    ...init,
    headers: {
      ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token}`
    }
  });
}

async function sonos(path: string, init: RequestInit = {}): Promise<unknown> {
  let response = await send(path, init);
  // An access token Sonos no longer accepts: get a fresh one and try once more.
  if (response.status === 401) {
    discardSonosAccessToken();
    response = await send(path, init);
  }
  if (!response.ok) throw new Error(`Sonos did not answer (${response.status}).`);
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function parseHousehold(householdId: string, value: unknown): { groups: SonosGroup[]; rooms: SonosRoom[] } {
  const reply = recordOf(value);
  const rooms = list(reply['players']).flatMap((player): SonosRoom[] => {
    const id = text(recordOf(player)['id']);
    const name = text(recordOf(player)['name']);
    return id && name ? [{ id, name, householdId }] : [];
  });
  const roomNames = new Map(rooms.map(room => [room.id, room.name]));
  const groups = list(reply['groups']).flatMap((entry): SonosGroup[] => {
    const { id, name, coordinatorId, playerIds, playbackState } = recordOf(entry);
    const groupId = text(id);
    if (!groupId) return [];
    const ids = list(playerIds).filter((player): player is string => typeof player === 'string');
    const coordinator = text(coordinatorId);
    const ordered = coordinator ? [coordinator, ...ids.filter(player => player !== coordinator)] : ids;
    const groupRooms = ordered.map(player => roomNames.get(player)).filter(room => room !== undefined);
    const groupName = text(name) ?? groupRooms[0];
    if (!groupName) return [];
    const playing = playbackState === 'PLAYBACK_STATE_PLAYING';
    return [{ id: groupId, name: groupName, rooms: groupRooms, householdId, playerIds: ordered, playing }];
  });
  return { groups, rooms };
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** Every Sonos group and room in every household the login can reach, each sorted by name. */
export async function listSonos(): Promise<{ groups: SonosGroup[]; rooms: SonosRoom[] }> {
  const households = list(recordOf(await sonos('/households'))['households'])
    .map(household => text(recordOf(household)['id']))
    .filter(id => id !== undefined);
  const replies = await Promise.all(
    households.map(async id => parseHousehold(id, await sonos(`/households/${id}/groups`)))
  );
  return {
    groups: replies.flatMap(reply => reply.groups).toSorted(byName),
    rooms: replies.flatMap(reply => reply.rooms).toSorted(byName)
  };
}

/**
 * Makes the group play on exactly these rooms: rooms not listed leave it (and play on their own), rooms from other
 * groups join it. The group's id can change, so read the groups again afterwards.
 */
export async function setGroupRooms(groupId: string, playerIds: readonly string[]): Promise<void> {
  await sonos(`/groups/${groupId}/groups/setGroupMembers`, {
    method: 'POST',
    body: JSON.stringify({ playerIds })
  });
}

/** The group's volume, 0 to 100; null when Sonos does not say (or the volume is fixed). */
export async function getGroupVolume(groupId: string): Promise<number | null> {
  const { volume, fixed } = recordOf(await sonos(`/groups/${groupId}/groupVolume`));
  return fixed !== true && typeof volume === 'number' && Number.isFinite(volume) ? volume : null;
}

export async function setGroupVolume(groupId: string, volume: number): Promise<void> {
  const clamped = Math.round(Math.min(100, Math.max(0, volume)));
  await sonos(`/groups/${groupId}/groupVolume`, { method: 'POST', body: JSON.stringify({ volume: clamped }) });
}

/** A song as Sonos describes it. */
export interface SonosTrack {
  name: string;
  artist?: string;
  album?: string;
  imageUrl?: string;
  durationMs?: number;
  /** The Spotify URI, when the song comes from Spotify. */
  uri?: string;
}

/** What a group plays: the song, the next one, where in the song it is, and which controls Sonos allows. */
export interface SonosPlayback {
  /** Playing, or about to (buffering); false when paused or stopped. */
  playing: boolean;
  positionMs: number;
  track: SonosTrack | null;
  next: SonosTrack | null;
  canSkip: boolean;
  canSkipBack: boolean;
  canSeek: boolean;
}

export type SonosCommand = 'play' | 'pause' | 'skipToNextTrack' | 'skipToPreviousTrack';

const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
// Sonos names a Spotify song in its own way: "spotify:track:<id>", or that URI URL-encoded after "x-sonos-spotify:".
const SPOTIFY_TRACK = /spotify(?::|%3[aA])track(?::|%3[aA])([0-9A-Za-z]{22})/;

function parseTrack(item: unknown): SonosTrack | null {
  const track = recordOf(recordOf(item)['track']);
  const name = text(track['name']);
  if (!name) return null;
  const id = SPOTIFY_TRACK.exec(text(recordOf(track['id'])['objectId']) ?? '')?.[1];
  const parsed: SonosTrack = { name };
  const artist = text(recordOf(track['artist'])['name']);
  const album = text(recordOf(track['album'])['name']);
  const imageUrl = text(track['imageUrl']);
  const durationMs = number(track['durationMillis']);
  if (artist) parsed.artist = artist;
  if (album) parsed.album = album;
  if (imageUrl?.startsWith('https://')) parsed.imageUrl = imageUrl;
  if (durationMs) parsed.durationMs = durationMs;
  if (id) parsed.uri = `spotify:track:${id}`;
  return parsed;
}

/** What the group plays right now (two calls: its playback state and its song). */
export async function getGroupPlayback(groupId: string): Promise<SonosPlayback> {
  const [status, metadata] = await Promise.all([
    sonos(`/groups/${groupId}/playback`),
    sonos(`/groups/${groupId}/playbackMetadata`)
  ]);
  const { playbackState, positionMillis, availablePlaybackActions } = recordOf(status);
  const actions = recordOf(availablePlaybackActions);
  const { currentItem, nextItem } = recordOf(metadata);
  return {
    playing: playbackState === 'PLAYBACK_STATE_PLAYING' || playbackState === 'PLAYBACK_STATE_BUFFERING',
    positionMs: number(positionMillis) ?? 0,
    track: parseTrack(currentItem),
    next: parseTrack(nextItem),
    canSkip: actions['canSkip'] !== false,
    canSkipBack: actions['canSkipBack'] !== false,
    canSeek: actions['canSeek'] !== false
  };
}

/** Plays, pauses or skips on the group. */
export async function sendGroupCommand(groupId: string, command: SonosCommand): Promise<void> {
  await sonos(`/groups/${groupId}/playback/${command}`, { method: 'POST', body: '{}' });
}

/** Moves the group to this point in the song. */
export async function seekGroup(groupId: string, positionMs: number): Promise<void> {
  const positionMillis = Math.max(0, Math.round(positionMs));
  await sonos(`/groups/${groupId}/playback/seek`, { method: 'POST', body: JSON.stringify({ positionMillis }) });
}

/**
 * The Spotify Connect device that plays to this group. Spotify names a Sonos device after its room, and a grouped
 * Sonos shows up under the group's name or the coordinator's room.
 */
export function spotifyDeviceFor(group: SonosGroup, devices: readonly SpotifyDevice[]): SpotifyDevice | undefined {
  const names = new Set([group.name, ...group.rooms.slice(0, 1)].map(name => name.toLowerCase()));
  return devices.find(device => device.id && names.has(device.name.toLowerCase()));
}
