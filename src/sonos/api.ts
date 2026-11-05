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

/**
 * The Spotify Connect device that plays to this group. Spotify names a Sonos device after its room, and a grouped
 * Sonos shows up under the group's name or the coordinator's room.
 */
export function spotifyDeviceFor(group: SonosGroup, devices: readonly SpotifyDevice[]): SpotifyDevice | undefined {
  const names = new Set([group.name, ...group.rooms.slice(0, 1)].map(name => name.toLowerCase()));
  return devices.find(device => device.id && names.has(device.name.toLowerCase()));
}
