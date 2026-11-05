import { describe, expect, it } from 'vitest';
import {
  parseDevice,
  parseDevices,
  parsePlaybackState,
  parsePlaylists,
  parseQueue,
  parseRecentlyPlayed,
  parseSearch,
  parseTrack,
  recordOf
} from './parse';

describe('spotify/parse', () => {
  describe('recordOf', () => {
    it('returns objects as they are and anything else as an empty object', () => {
      const object = { a: 1 };
      expect(recordOf(object)).toBe(object);
      for (const value of [null, undefined, 'text', 3, [1, 2]]) expect(recordOf(value)).toEqual({});
    });
  });

  describe('parseTrack', () => {
    it('keeps the known fields that have the right type', () => {
      const track = {
        id: 'a',
        name: 'Song',
        title: 'Song',
        artist: 'Singer',
        albumArt: 'https://art/a.jpg',
        uri: 'spotify:track:a',
        duration_ms: 1000,
        album: { images: [{ url: 'https://art/b.jpg' }] },
        artists: [{ name: 'Singer' }],
        external_urls: { spotify: 'https://open.spotify.com/track/a' }
      };
      expect(parseTrack(track)).toEqual(track);
    });

    it('drops unknown fields and fields of the wrong type', () => {
      expect(parseTrack({ id: 1, name: 'Song', duration_ms: '3', votes: 2, extra: true, addedBy: 'Ann' })).toEqual({
        name: 'Song'
      });
    });

    it('keeps the shape of nested lists but not their invalid entries', () => {
      expect(
        parseTrack({
          album: { images: [{ url: 'u' }, { url: 3 }, 'x'] },
          artists: [{ name: 'A' }, null, { name: 4 }],
          external_urls: { spotify: 5 }
        })
      ).toEqual({ album: { images: [{ url: 'u' }, {}] }, artists: [{ name: 'A' }, {}], external_urls: {} });
    });

    it('is undefined for anything but an object', () => {
      for (const value of [null, undefined, 'a', 1, []]) expect(parseTrack(value)).toBeUndefined();
    });
  });

  describe('parseDevice', () => {
    it('needs a string id and name', () => {
      expect(parseDevice({ id: 'd' })).toBeUndefined();
      expect(parseDevice({ id: 1, name: 'n' })).toBeUndefined();
      expect(parseDevice({ id: null })).toBeUndefined();
      expect(parseDevice('d')).toBeUndefined();
    });

    it('keeps a device with a null id so it can be shown as unavailable', () => {
      expect(parseDevice({ id: null, name: 'Sonos Roam', type: 'Speaker' })).toEqual({
        id: null,
        name: 'Sonos Roam',
        type: 'Speaker'
      });
    });

    it('keeps the optional fields, including a null volume', () => {
      const device = {
        id: 'd',
        name: 'Kitchen',
        type: 'Speaker',
        is_active: true,
        is_restricted: false,
        supports_volume: true,
        volume_percent: null
      };
      expect(parseDevice(device)).toEqual(device);
      expect(parseDevice({ id: 'd', name: 'n', volume_percent: 40, type: 3, is_active: 'yes' })).toEqual({
        id: 'd',
        name: 'n',
        volume_percent: 40
      });
    });
  });

  describe('parsePlaybackState', () => {
    it('is null when nothing is playing', () => {
      expect(parsePlaybackState(null)).toBeNull();
      expect(parsePlaybackState('')).toBeNull();
    });

    it('parses the device, the track, the progress and the disallowed actions', () => {
      expect(
        parsePlaybackState({
          is_playing: true,
          device: { id: 'd', name: 'n' },
          item: { id: 't' },
          progress_ms: 5,
          actions: { disallows: { pausing: true, seeking: 'no', unknown: true } },
          context: 'ignored'
        })
      ).toEqual({
        is_playing: true,
        device: { id: 'd', name: 'n' },
        item: { id: 't' },
        progress_ms: 5,
        actions: { disallows: { pausing: true } }
      });
    });

    it('keeps the shuffle and repeat settings and drops an unknown repeat mode', () => {
      expect(parsePlaybackState({ shuffle_state: true, repeat_state: 'track' })).toEqual({
        shuffle_state: true,
        repeat_state: 'track'
      });
      expect(parsePlaybackState({ shuffle_state: 'yes', repeat_state: 'forever' })).toEqual({});
    });

    it('treats a null item (an ad) and an invalid device as missing', () => {
      expect(parsePlaybackState({ is_playing: false, item: null, device: { id: 1 } })).toEqual({ is_playing: false });
    });
  });

  describe('parseSearch', () => {
    it('lists the songs with their album to carry on from, then the albums, then the playlists', () => {
      expect(
        parseSearch({
          tracks: {
            items: [
              {
                uri: 'spotify:track:t',
                name: 'Song',
                artists: [{ name: 'A' }],
                album: { uri: 'spotify:album:a', images: [{ url: 'https://art/a.jpg' }] }
              },
              { uri: 'spotify:track:u', name: 'Bare' },
              { name: 'No uri' }
            ]
          },
          albums: { items: [{ uri: 'spotify:album:b', name: 'Record', artists: [{ name: 'B' }], images: [] }, {}] },
          playlists: { items: [null, { uri: 'spotify:playlist:p', name: 'Mix', owner: { display_name: 'Max' } }] }
        })
      ).toEqual([
        {
          uri: 'spotify:track:t',
          name: 'Song',
          detail: 'Song · A',
          image: 'https://art/a.jpg',
          contextUri: 'spotify:album:a'
        },
        { uri: 'spotify:track:u', name: 'Bare', detail: 'Song' },
        { uri: 'spotify:album:b', name: 'Record', detail: 'Album · B' },
        { uri: 'spotify:playlist:p', name: 'Mix', detail: 'Playlist · By Max' }
      ]);
      expect(parseSearch(null)).toEqual([]);
    });
  });

  describe('parseRecentlyPlayed and parsePlaylists', () => {
    it('keeps each recent track once, with its artists, art and context', () => {
      const track = {
        uri: 'spotify:track:t',
        name: 'Song',
        artists: [{ name: 'A' }, { name: 'B' }, {}],
        album: { images: [{}, { url: 'https://art/t.jpg' }] }
      };
      expect(
        parseRecentlyPlayed({
          items: [
            { track, context: { uri: 'spotify:playlist:p' } },
            { track, context: null },
            { track: { uri: 'spotify:track:u', name: 'Other' }, context: { uri: 3 } },
            { track: { name: 'No uri' } },
            'junk'
          ]
        })
      ).toEqual([
        {
          uri: 'spotify:track:t',
          name: 'Song',
          detail: 'A, B',
          image: 'https://art/t.jpg',
          contextUri: 'spotify:playlist:p'
        },
        { uri: 'spotify:track:u', name: 'Other' }
      ]);
      expect(parseRecentlyPlayed(null)).toEqual([]);
    });

    it('keeps playlists with a name and uri, their owner and their art', () => {
      expect(
        parsePlaylists({
          items: [
            {
              uri: 'spotify:playlist:p',
              name: 'Mix',
              owner: { display_name: 'Max' },
              images: [{ url: 'https://art/p.jpg' }]
            },
            { uri: 'spotify:playlist:q', name: 'Bare', owner: {}, images: null },
            { uri: 'spotify:playlist:r' },
            null
          ]
        })
      ).toEqual([
        { uri: 'spotify:playlist:p', name: 'Mix', detail: 'By Max', image: 'https://art/p.jpg' },
        { uri: 'spotify:playlist:q', name: 'Bare' }
      ]);
      expect(parsePlaylists({ items: 'x' })).toEqual([]);
    });
  });

  describe('parseQueue and parseDevices', () => {
    it('fall back to empty results for a missing or malformed body', () => {
      expect(parseQueue(null)).toEqual({ currently_playing: null, queue: [] });
      expect(parseQueue({ currently_playing: 'x', queue: 'y' })).toEqual({ currently_playing: null, queue: [] });
      expect(parseDevices(null)).toEqual({ devices: [] });
      expect(parseDevices({ devices: 'x' })).toEqual({ devices: [] });
    });

    it('keep the valid entries', () => {
      expect(parseQueue({ currently_playing: { id: 'a' }, queue: [{ id: 'b' }, null] })).toEqual({
        currently_playing: { id: 'a' },
        queue: [{ id: 'b' }]
      });
      expect(parseDevices({ devices: [{ id: 'd', name: 'n' }, { id: 'e' }] })).toEqual({
        devices: [{ id: 'd', name: 'n' }]
      });
    });
  });
});
