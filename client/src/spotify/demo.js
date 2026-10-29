// A simulated Spotify player for demo mode, ported from the old server. It answers like the real Web API does but
// keeps everything in memory, so demo mode needs no network and no Spotify account.

import { SpotifyApiError } from './http.js';

/** @param {string} id */
const image = id => `https://images.unsplash.com/${id}?w=600&auto=format&fit=crop&q=80`;
/** @typedef {ReturnType<typeof track>} DemoTrack */
/**
 * @param {string} id
 * @param {string} name
 * @param {string} artist
 * @param {string} art
 * @param {number} duration
 * @param {string} guest
 */
const track = (id, name, artist, art, duration, guest) => ({
  id,
  name,
  artists: [{ name: artist }],
  duration_ms: duration,
  album: { images: [{ url: image(art) }] },
  added_by: { name: guest }
});

/** Spotify does not allow these on a real queue, so they exist only in the demo. */
const DEMO_ONLY_MESSAGE =
  'Spotify does not expose live queue reordering or non-destructive play-now. Manage the queue in Spotify.';

/** A fresh demo party: one track playing, four queued. */
export function createDemoPlayer() {
  const playback = {
    is_playing: true,
    progress_ms: 45000,
    device: { id: 'demo-tablet', name: 'Demo tablet', is_active: true, volume_percent: 80, supports_volume: true },
    item: track('demo-track-1', 'One More Time', 'Daft Punk', 'photo-1514525253161-7a46d19cd819', 320000, 'Sarah')
  };
  /** @type {DemoTrack[]} */
  let queue = [
    track('demo-queue-1', 'Starboy', 'The Weeknd, Daft Punk', 'photo-1511671782779-c97d3d27a1d4', 230000, 'Marcus'),
    track('demo-queue-2', 'Levitating', 'Dua Lipa', 'photo-1470225620780-dba8ba36b745', 203000, 'Elena'),
    track(
      'demo-queue-3',
      'Music Sounds Better with You',
      'Stardust',
      'photo-1508700115892-45ecd05ae2ad',
      260000,
      'Dave'
    ),
    track('demo-queue-4', 'Midnight City', 'M83', 'photo-1518609878373-06d740f60d8b', 244000, 'Chloe')
  ];
  /** @type {DemoTrack[]} */
  const history = [];

  return {
    /** Copies, so callers cannot change the simulation by editing what they were given. */
    getPlaybackState: () => structuredClone(playback),
    getQueue: () => structuredClone({ currently_playing: playback.item, queue }),
    getDevices: () => structuredClone({ devices: [playback.device] }),
    /**
     * @param {string} deviceId
     * @param {boolean} play
     */
    transferPlayback(deviceId, play) {
      if (deviceId !== playback.device.id) throw new SpotifyApiError('Demo device not found.', 404);
      playback.is_playing = play;
    },
    play() {
      playback.is_playing = true;
    },
    pause() {
      playback.is_playing = false;
    },
    /** @param {'next' | 'previous'} direction */
    skip(direction) {
      const source = direction === 'next' ? queue : history;
      const target = direction === 'next' ? source.shift() : source.pop();
      if (!target) throw new SpotifyApiError(`No ${direction} demo track available.`, 409);
      if (direction === 'next') history.push(playback.item);
      else queue.unshift(playback.item);
      playback.item = target;
      playback.progress_ms = 0;
    },
    /** @param {number} positionMs */
    seek(positionMs) {
      playback.progress_ms = Math.min(positionMs, playback.item.duration_ms);
    },
    /** @param {number} percent */
    setVolume(percent) {
      playback.device.volume_percent = percent;
    },
    /** @param {({ id?: unknown } | null)[]} submitted */
    reorder(submitted) {
      const reordered = Array.isArray(submitted)
        ? submitted.map(entry => queue.find(existing => existing.id === entry?.id))
        : [];
      if (
        reordered.length !== queue.length ||
        new Set(reordered).size !== queue.length ||
        reordered.includes(undefined)
      ) {
        throw new SpotifyApiError('Reordering requires each existing demo track exactly once.', 400);
      }
      // Validated above: every submitted id matched exactly one existing demo track, and none twice.
      queue = /** @type {DemoTrack[]} */ (reordered);
      return structuredClone({ queue });
    },
    /** @param {string} trackId */
    playNow(trackId) {
      const index = queue.findIndex(existing => existing.id === trackId);
      const [target] = index === -1 ? [] : queue.splice(index, 1);
      if (!target) throw new SpotifyApiError('Demo track not found.', 404);
      history.push(playback.item);
      playback.item = target;
      playback.progress_ms = 0;
      playback.is_playing = true;
      return structuredClone({ remainingQueue: queue });
    }
  };
}

export { DEMO_ONLY_MESSAGE };
