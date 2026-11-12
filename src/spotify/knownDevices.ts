// Spotify speakers the app has seen playing. Spotify's device list (GET /me/player/devices) leaves some speakers out,
// Sonos among them, even while they play; the playback state still names them, with an id that playback can be moved to.
// So each speaker seen playing is remembered here, and the Speakers view offers it even when Spotify does not list it.
// Storage can be unavailable: every access tolerates that.

import type { SpotifyDevice } from '../types';
import { parseJson } from './http';
import { parseDevice } from './parse';

const KEY = 'maxmix.knownSpeakers';
const MAX_SPEAKERS = 20;

/** The remembered speakers, most recently seen first. */
export function getKnownSpeakers(): SpotifyDevice[] {
  try {
    const stored: unknown = parseJson(localStorage.getItem(KEY) ?? '[]');
    return (Array.isArray(stored) ? stored : []).flatMap((entry): SpotifyDevice[] => {
      const device = parseDevice(entry);
      return device?.id ? [{ id: device.id, name: device.name, ...(device.type && { type: device.type }) }] : [];
    });
  } catch {
    return [];
  }
}

/**
 * Remembers a speaker seen playing. Only speakers: a phone or computer comes and goes, and this tablet's own player gets
 * a new id each time the page opens.
 */
export function rememberSpeaker(device: SpotifyDevice | undefined): void {
  if (!device?.id || device.type?.toLowerCase() !== 'speaker') return;
  const { id, name, type } = device;
  const known = getKnownSpeakers();
  if (known[0]?.id === id && known[0].name === name) return;
  const next = [{ id, name, type }, ...known.filter(other => other.id !== id)].slice(0, MAX_SPEAKERS);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage is unavailable; the speaker is then offered only while Spotify lists it.
  }
}
