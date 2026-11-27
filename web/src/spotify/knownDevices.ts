// Spotify speakers the app has seen playing. Spotify's device list (GET /me/player/devices) leaves some speakers out,
// Sonos among them, even while they play; the playback state still names them, with an id that playback can be moved to.
// So each speaker seen playing is remembered here, and the Speakers view offers it even when Spotify does not list it.
// Device ids belong to a Spotify account, so each person signed in on the kiosk has their own list, keyed by their
// Spotify ID.
// The list kept before there were people (a plain array) moves to the active person once their Spotify ID is known;
// until then it stays the active person's list. Storage can be unavailable: every access tolerates that.

import type { SpotifyDevice } from '../types';
import { getActivePersonId } from './auth';
import { parseJson } from './http';
import { parseDevice } from './parse';

const KEY = 'maxmix.knownSpeakers';
const MAX_SPEAKERS = 20;

type Stored = { legacy: unknown[] } | { byPerson: Record<string, unknown> };

function readStored(): Stored {
  const stored: unknown = parseJson(localStorage.getItem(KEY) ?? '{}');
  if (Array.isArray(stored)) return { legacy: stored };
  return { byPerson: stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {} };
}

function parseSpeakers(entries: unknown): SpotifyDevice[] {
  return (Array.isArray(entries) ? entries : []).flatMap((entry): SpotifyDevice[] => {
    const device = parseDevice(entry);
    return device?.id ? [{ id: device.id, name: device.name, ...(device.type && { type: device.type }) }] : [];
  });
}

/** Stores `speakers` as the active person's list; with no Spotify ID yet, as the old single list. */
function writeSpeakers(personId: string | null, speakers: SpotifyDevice[]): void {
  try {
    const stored = readStored();
    if (!personId) {
      // Nobody named yet: only the old single list can be kept, and only when no per-person lists exist.
      if ('legacy' in stored || Object.keys(stored.byPerson).length === 0) {
        localStorage.setItem(KEY, JSON.stringify(speakers));
      }
      return;
    }
    const byPerson = 'byPerson' in stored ? stored.byPerson : {};
    localStorage.setItem(KEY, JSON.stringify({ ...byPerson, [personId]: speakers }));
  } catch {
    // Storage is unavailable; the speaker is then offered only while Spotify lists it.
  }
}

/** The active person's remembered speakers, most recently seen first. */
export function getKnownSpeakers(): SpotifyDevice[] {
  const personId = getActivePersonId();
  try {
    const stored = readStored();
    if ('legacy' in stored) {
      const speakers = parseSpeakers(stored.legacy);
      // The list from before there were people becomes the active person's, once they are known.
      if (personId) writeSpeakers(personId, speakers);
      return speakers;
    }
    return personId ? parseSpeakers(stored.byPerson[personId]) : [];
  } catch {
    return [];
  }
}

/**
 * Remembers a speaker seen playing, for the active person. Only speakers: a phone or computer comes and goes, and this
 * tablet's own player gets a new id each time the page opens.
 */
export function rememberSpeaker(device: SpotifyDevice | undefined): void {
  if (!device?.id || device.type?.toLowerCase() !== 'speaker') return;
  const { id, name, type } = device;
  const known = getKnownSpeakers();
  if (known[0]?.id === id && known[0].name === name) return;
  const next = [{ id, name, type }, ...known.filter(other => other.id !== id)].slice(0, MAX_SPEAKERS);
  writeSpeakers(getActivePersonId(), next);
}
