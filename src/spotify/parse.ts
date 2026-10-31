// Turns the untrusted JSON that Spotify (and the browser's storage) hands back into the app's types. Each parser keeps
// the fields it knows when they have the right type and drops the rest, so a malformed reply degrades to missing data
// instead of reaching the UI as a value of the wrong type.
import type { PlaybackState, SpotifyDevice, Track } from '../types';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The object itself, or an empty one for anything else, so fields can be read without a guard each time. */
export const recordOf = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const flag = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Lists parse element by element; entries that are not objects are dropped. */
const parseAll = <T>(value: unknown, parse: (entry: unknown) => T | undefined): T[] =>
  list(value).flatMap(entry => {
    const parsed = parse(entry);
    return parsed === undefined ? [] : [parsed];
  });

function parsePerson(value: unknown): { avatar?: string; name?: string } | undefined {
  if (!isRecord(value)) return undefined;
  const avatar = text(value['avatar']);
  const name = text(value['name']);
  return { ...(avatar !== undefined && { avatar }), ...(name !== undefined && { name }) };
}

export function parseTrack(value: unknown): Track | undefined {
  if (!isRecord(value)) return undefined;
  const track: Track = {};
  for (const key of ['id', 'title', 'name', 'artist', 'albumArt', 'uri'] as const) {
    const field = text(value[key]);
    if (field !== undefined) track[key] = field;
  }
  const durationMs = finite(value['duration_ms']);
  if (durationMs !== undefined) track.duration_ms = durationMs;
  const addedBy = parsePerson(value['addedBy']);
  if (addedBy) track.addedBy = addedBy;
  const addedByAlias = parsePerson(value['added_by']);
  if (addedByAlias) track.added_by = addedByAlias;
  if (isRecord(value['album'])) {
    track.album = {
      images: parseAll(value['album']['images'], image => {
        if (!isRecord(image)) return;
        const url = text(image['url']);
        return url === undefined ? {} : { url };
      })
    };
  }
  if (Array.isArray(value['artists'])) {
    track.artists = parseAll(value['artists'], artist => {
      if (!isRecord(artist)) return;
      const name = text(artist['name']);
      return name === undefined ? {} : { name };
    });
  }
  if (isRecord(value['external_urls'])) {
    const spotify = text(value['external_urls']['spotify']);
    track.external_urls = spotify === undefined ? {} : { spotify };
  }
  return track;
}

export function parseDevice(value: unknown): SpotifyDevice | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value['id']);
  const name = text(value['name']);
  if (id === undefined || name === undefined) return undefined;
  const device: SpotifyDevice = { id, name };
  const type = text(value['type']);
  if (type !== undefined) device.type = type;
  const active = flag(value['is_active']);
  if (active !== undefined) device.is_active = active;
  const restricted = flag(value['is_restricted']);
  if (restricted !== undefined) device.is_restricted = restricted;
  const supportsVolume = flag(value['supports_volume']);
  if (supportsVolume !== undefined) device.supports_volume = supportsVolume;
  // Spotify reports null for a device whose volume cannot be set.
  const volume = value['volume_percent'] === null ? null : finite(value['volume_percent']);
  if (volume !== undefined) device.volume_percent = volume;
  return device;
}

const DISALLOWS = ['seeking', 'skipping_prev', 'skipping_next', 'pausing', 'resuming'] as const;

export function parsePlaybackState(value: unknown): PlaybackState | null {
  if (!isRecord(value)) return null;
  const state: PlaybackState = {};
  const playing = flag(value['is_playing']);
  if (playing !== undefined) state.is_playing = playing;
  const device = parseDevice(value['device']);
  if (device) state.device = device;
  // Spotify sends `item: null` for an ad or an unsupported item; that is the same as no track.
  const item = parseTrack(value['item']);
  if (item) state.item = item;
  const progress = finite(value['progress_ms']);
  if (progress !== undefined) state.progress_ms = progress;
  if (isRecord(value['actions']) && isRecord(value['actions']['disallows'])) {
    const source = value['actions']['disallows'];
    const disallows: NonNullable<NonNullable<PlaybackState['actions']>['disallows']> = {};
    for (const key of DISALLOWS) {
      const disallowed = flag(source[key]);
      if (disallowed !== undefined) disallows[key] = disallowed;
    }
    state.actions = { disallows };
  }
  return state;
}

export function parseQueue(value: unknown): { currently_playing: Track | null; queue: Track[] } {
  const source = isRecord(value) ? value : {};
  return {
    currently_playing: parseTrack(source['currently_playing']) ?? null,
    queue: parseAll(source['queue'], parseTrack)
  };
}

export function parseDevices(value: unknown): { devices: SpotifyDevice[] } {
  return { devices: parseAll(isRecord(value) ? value['devices'] : undefined, parseDevice) };
}
