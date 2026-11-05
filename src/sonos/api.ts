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

function parseGroups(value: unknown): SonosGroup[] {
  const reply = recordOf(value);
  const playerNames = new Map<string, string>();
  const players = list(reply['players']);
  for (const player of players) {
    const { id, name } = recordOf(player);
    if (text(id) && text(name)) playerNames.set(id as string, name as string);
  }
  return list(reply['groups']).flatMap((entry): SonosGroup[] => {
    const { id, name, coordinatorId, playerIds } = recordOf(entry);
    const groupId = text(id);
    if (!groupId) return [];
    const ids = list(playerIds).filter((player): player is string => typeof player === 'string');
    const coordinator = text(coordinatorId);
    const ordered = coordinator ? [coordinator, ...ids.filter(player => player !== coordinator)] : ids;
    const rooms = ordered.map(player => playerNames.get(player)).filter(room => room !== undefined);
    const groupName = text(name) ?? rooms[0];
    return groupName ? [{ id: groupId, name: groupName, rooms }] : [];
  });
}

/** Every Sonos group in every household the login can reach, sorted by name. */
export async function listSonosGroups(): Promise<SonosGroup[]> {
  const households = list(recordOf(await sonos('/households'))['households'])
    .map(household => text(recordOf(household)['id']))
    .filter(id => id !== undefined);
  const groups = await Promise.all(households.map(async id => parseGroups(await sonos(`/households/${id}/groups`))));
  return groups.flat().toSorted((a, b) => a.name.localeCompare(b.name));
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
