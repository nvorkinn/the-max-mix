import type { Page } from '@playwright/test';
import { getClientId } from '../src/spotify/settings.ts';
import type { PlaybackState, SpotifyDevice, Track } from '../src/types.ts';

const track = (id: string, name: string, artist: string, durationMs: number): Track => ({
  id,
  uri: `spotify:track:${id}`,
  name,
  artists: [{ name: artist }],
  duration_ms: durationMs,
  album: { images: [{ url: `https://images.unsplash.com/${id}` }] }
});

/**
 * Signs the page in to a fake Spotify account that answers in memory: one track playing on a Spotify Connect speaker
 * and four queued. Play, pause, seek, next, previous, shuffle, repeat, volume and saving a song change what it reports, like
 * the real Web API does. Returns what a test may want to look at: every command it was sent, and the saved songs.
 */
export async function fakeSpotify(page: Page) {
  const commands: string[] = [];
  const saved = new Set<string>();
  const playback = {
    is_playing: true as boolean,
    shuffle_state: false as boolean,
    repeat_state: 'off' as 'off' | 'context' | 'track',
    progress_ms: 45_000,
    // Typed as a device, not as this one literal: which device is active changes when the page plays elsewhere.
    device: {
      id: 'test-speaker',
      name: 'Test speaker',
      is_active: true,
      is_restricted: false,
      supports_volume: true,
      volume_percent: 80
    } as SpotifyDevice,
    item: track('track-1', 'One More Time', 'Daft Punk', 320_000)
  } satisfies PlaybackState;
  const queue = [
    track('queue-1', 'Starboy', 'The Weeknd, Daft Punk', 230_000),
    track('queue-2', 'Levitating', 'Dua Lipa', 203_000),
    track('queue-3', 'Music Sounds Better with You', 'Stardust', 260_000),
    track('queue-4', 'Midnight City', 'M83', 244_000)
  ];
  const history: Track[] = [];
  // The devices Spotify lists: the speaker that plays, and any other one (this tablet's own player) once it is played on.
  const devices = [playback.device];
  const play = (target: Track) => {
    playback.item = target;
    playback.progress_ms = 0;
  };

  await page.route('https://accounts.spotify.com/api/token', route =>
    route.fulfill({ json: { access_token: 'not-a-real-access-token', expires_in: 3600 } })
  );
  await page.route('https://api.spotify.com/v1/**', route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (route.request().method() !== 'GET') commands.push(`${route.request().method()} ${path}${url.search}`);
    switch (`${route.request().method()} ${path}`) {
      case 'GET /v1/me/player': {
        return route.fulfill({ json: playback });
      }
      case 'GET /v1/me/player/queue': {
        return route.fulfill({ json: { currently_playing: playback.item, queue } });
      }
      case 'GET /v1/me/player/devices': {
        return route.fulfill({ json: { devices } });
      }
      case 'PUT /v1/me/player': {
        // Playing on another device: the one named in the body becomes the active one.
        const id = (route.request().postDataJSON() as { device_ids: string[] }).device_ids[0] ?? '';
        let target = devices.find(device => device.id === id);
        if (!target) {
          target = { ...playback.device, id, name: 'The Max Mix', is_active: false };
          devices.push(target);
        }
        for (const device of devices) device.is_active = device === target;
        playback.device = target;
        return route.fulfill({ status: 204 });
      }
      case 'PUT /v1/me/player/play': {
        playback.is_playing = true;
        return route.fulfill({ status: 204 });
      }
      case 'PUT /v1/me/player/pause': {
        playback.is_playing = false;
        return route.fulfill({ status: 204 });
      }
      case 'PUT /v1/me/player/shuffle': {
        playback.shuffle_state = url.searchParams.get('state') === 'true';
        return route.fulfill({ status: 204 });
      }
      case 'PUT /v1/me/player/repeat': {
        playback.repeat_state = url.searchParams.get('state') as typeof playback.repeat_state;
        return route.fulfill({ status: 204 });
      }
      case 'PUT /v1/me/player/volume': {
        playback.device.volume_percent = Number(url.searchParams.get('volume_percent'));
        return route.fulfill({ status: 204 });
      }
      case 'GET /v1/me/library/contains': {
        return route.fulfill({ json: [saved.has(url.searchParams.get('uris') ?? '')] });
      }
      case 'PUT /v1/me/library': {
        saved.add(url.searchParams.get('uris') ?? '');
        return route.fulfill({ status: 204 });
      }
      case 'DELETE /v1/me/library': {
        saved.delete(url.searchParams.get('uris') ?? '');
        return route.fulfill({ status: 204 });
      }
      case 'PUT /v1/me/player/seek': {
        playback.progress_ms = Number(new URL(route.request().url()).searchParams.get('position_ms'));
        return route.fulfill({ status: 204 });
      }
      case 'POST /v1/me/player/next': {
        const target = queue.shift();
        if (!target) return route.fulfill({ status: 409 });
        history.push(playback.item);
        play(target);
        return route.fulfill({ status: 204 });
      }
      case 'POST /v1/me/player/previous': {
        const target = history.pop();
        if (!target) return route.fulfill({ status: 409 });
        queue.unshift(playback.item);
        play(target);
        return route.fulfill({ status: 204 });
      }
      default: {
        return route.fulfill({ status: 204 });
      }
    }
  });
  await page.addInitScript(clientId => {
    localStorage.setItem('maxmix.playbackMode', 'remote');
    localStorage.setItem('maxmix.auth', JSON.stringify({ clientId, refreshToken: 'not-a-real-refresh-token' }));
  }, getClientId());
  return { commands, saved };
}

/** Counts the app's reads of the playback state (GET /v1/me/player), which is what its polling is. */
export function countPlaybackReads(page: Page) {
  let reads = 0;
  page.on('request', request => {
    const { pathname } = new URL(request.url());
    if (pathname === '/v1/me/player' && request.method() === 'GET') reads++;
  });
  return () => reads;
}
