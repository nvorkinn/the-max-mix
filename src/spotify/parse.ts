// Turns the untrusted JSON that Spotify (and the browser's storage) hands back into the app's types. Each parser keeps
// the fields it knows when they have the right type and drops the rest, so a malformed reply degrades to missing data
// instead of reaching the UI as a value of the wrong type.
import type { MusicChoice, PlaybackState, SpotifyDevice, Track } from '../types';

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

export function parseTrack(value: unknown): Track | undefined {
  if (!isRecord(value)) return undefined;
  const track: Track = {};
  for (const key of ['id', 'title', 'name', 'artist', 'albumArt', 'uri'] as const) {
    const field = text(value[key]);
    if (field !== undefined) track[key] = field;
  }
  const durationMs = finite(value['duration_ms']);
  if (durationMs !== undefined) track.duration_ms = durationMs;
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
  // Spotify reports a null id for devices it lists but cannot address (e.g. some Sonos speakers); keep them so the
  // picker can show them as unavailable. Any other non-string id is malformed.
  const rawId = value['id'];
  const id = rawId === null || rawId === undefined ? null : text(rawId);
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

const DISALLOWS = [
  'seeking',
  'skipping_prev',
  'skipping_next',
  'pausing',
  'resuming',
  'toggling_shuffle',
  'toggling_repeat_context',
  'toggling_repeat_track'
] as const;
const REPEAT_MODES = ['off', 'context', 'track'] as const;

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
  const shuffle = flag(value['shuffle_state']);
  if (shuffle !== undefined) state.shuffle_state = shuffle;
  const repeat = REPEAT_MODES.find(mode => mode === value['repeat_state']);
  if (repeat) state.repeat_state = repeat;
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

const firstImage = (value: unknown): string | undefined =>
  text(recordOf(list(value).find(image => isRecord(image) && text(image['url'])))['url']);

/** The tracks in a recently-played reply, newest first, each once. */
export function parseRecentlyPlayed(value: unknown): MusicChoice[] {
  const seen = new Set<string>();
  return parseAll(recordOf(value)['items'], item => {
    const entry = recordOf(item);
    const track = recordOf(entry['track']);
    const uri = text(track['uri']);
    const name = text(track['name']);
    if (!uri || !name || seen.has(uri)) return;
    seen.add(uri);
    const choice: MusicChoice = { uri, name };
    const artists = parseAll(track['artists'], artist => text(recordOf(artist)['name'])).join(', ');
    if (artists) choice.detail = artists;
    const image = firstImage(recordOf(track['album'])['images']);
    if (image) choice.image = image;
    const contextUri = text(recordOf(entry['context'])['uri']);
    if (contextUri) choice.contextUri = contextUri;
    return choice;
  });
}

/** The user's playlists, as /me/playlists lists them. */
export function parsePlaylists(value: unknown): MusicChoice[] {
  return parseAll(recordOf(value)['items'], item => {
    const playlist = recordOf(item);
    const uri = text(playlist['uri']);
    const name = text(playlist['name']);
    if (!uri || !name) return;
    const choice: MusicChoice = { uri, name };
    const owner = text(recordOf(playlist['owner'])['display_name']);
    if (owner) choice.detail = `By ${owner}`;
    const image = firstImage(playlist['images']);
    if (image) choice.image = image;
    return choice;
  });
}

/** What a search finds, as /search lists it: the songs, then the albums, then the playlists. */
export function parseSearch(value: unknown): MusicChoice[] {
  const result = recordOf(value);
  const artistsOf = (item: Record<string, unknown>) =>
    parseAll(item['artists'], artist => text(recordOf(artist)['name'])).join(', ');
  const songs = parseAll(recordOf(result['tracks'])['items'], item => {
    const track = recordOf(item);
    const uri = text(track['uri']);
    const name = text(track['name']);
    if (!uri || !name) return;
    const album = recordOf(track['album']);
    // The album carries on after the song, as a recently played track carries on from where it was played.
    const choice: MusicChoice = { uri, name, detail: ['Song', artistsOf(track)].filter(Boolean).join(' · ') };
    const image = firstImage(album['images']);
    if (image) choice.image = image;
    const contextUri = text(album['uri']);
    if (contextUri) choice.contextUri = contextUri;
    return choice;
  });
  const albums = parseAll(recordOf(result['albums'])['items'], item => {
    const album = recordOf(item);
    const uri = text(album['uri']);
    const name = text(album['name']);
    if (!uri || !name) return;
    const choice: MusicChoice = { uri, name, detail: ['Album', artistsOf(album)].filter(Boolean).join(' · ') };
    const image = firstImage(album['images']);
    if (image) choice.image = image;
    return choice;
  });
  const playlists = parsePlaylists(result['playlists']).map(playlist => ({
    ...playlist,
    detail: ['Playlist', playlist.detail].filter(Boolean).join(' · ')
  }));
  return [...songs, ...albums, ...playlists];
}
