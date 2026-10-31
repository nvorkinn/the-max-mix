import type { Page } from '@playwright/test';
import { getClientId } from '../src/spotify/settings.ts';
import type { PlaybackState, Track } from '../src/types.ts';

const track = (id: string, name: string, artist: string, durationMs: number): Track => ({
  id,
  name,
  artists: [{ name: artist }],
  duration_ms: durationMs,
  album: { images: [{ url: `https://images.unsplash.com/${id}` }] }
});

/**
 * Signs the page in to a fake Spotify account that answers in memory: one track playing on a Spotify Connect speaker
 * and four queued. Play, pause, next and previous change what it reports, like the real Web API does.
 */
export async function fakeSpotify(page: Page) {
  const playback = {
    is_playing: true as boolean,
    progress_ms: 45_000,
    device: {
      id: 'test-speaker',
      name: 'Test speaker',
      is_active: true,
      is_restricted: false,
      supports_volume: true,
      volume_percent: 80
    },
    item: track('track-1', 'One More Time', 'Daft Punk', 320_000)
  } satisfies PlaybackState;
  const queue = [
    track('queue-1', 'Starboy', 'The Weeknd, Daft Punk', 230_000),
    track('queue-2', 'Levitating', 'Dua Lipa', 203_000),
    track('queue-3', 'Music Sounds Better with You', 'Stardust', 260_000),
    track('queue-4', 'Midnight City', 'M83', 244_000)
  ];
  const history: Track[] = [];
  const play = (target: Track) => {
    playback.item = target;
    playback.progress_ms = 0;
  };

  await page.route('https://accounts.spotify.com/api/token', route =>
    route.fulfill({ json: { access_token: 'not-a-real-access-token', expires_in: 3600 } })
  );
  await page.route('https://api.spotify.com/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    switch (`${route.request().method()} ${path}`) {
      case 'GET /v1/me/player': {
        return route.fulfill({ json: playback });
      }
      case 'GET /v1/me/player/queue': {
        return route.fulfill({ json: { currently_playing: playback.item, queue } });
      }
      case 'GET /v1/me/player/devices': {
        return route.fulfill({ json: { devices: [playback.device] } });
      }
      case 'PUT /v1/me/player/play': {
        playback.is_playing = true;
        return route.fulfill({ status: 204 });
      }
      case 'PUT /v1/me/player/pause': {
        playback.is_playing = false;
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
    /* eslint-disable n/no-unsupported-features/node-builtins -- This init script runs in the browser, not Node. */
    localStorage.setItem('maxmix.playbackMode', 'remote');
    localStorage.setItem('maxmix.auth', JSON.stringify({ clientId, refreshToken: 'not-a-real-refresh-token' }));
    /* eslint-enable n/no-unsupported-features/node-builtins */
  }, getClientId());
}
