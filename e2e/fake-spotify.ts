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

const art = (id: string) => [{ url: `https://images.unsplash.com/${id}` }];

/**
 * Signs the page in to a fake Spotify account that answers in memory: one track playing on a Spotify Connect speaker
 * and four queued. Play, pause, seek, next and previous change what it reports, like the real Web API does.
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
  const playlists = [
    { uri: 'spotify:playlist:friday', name: 'Friday Mix', owner: { display_name: 'Max' }, images: art('friday') },
    { uri: 'spotify:playlist:focus', name: 'Deep Focus', owner: { display_name: 'Spotify' }, images: art('focus') }
  ];
  const recentlyPlayed = [
    { track: { ...track('recent-1', 'Get Lucky', 'Daft Punk', 248_000), uri: 'spotify:track:recent1' }, context: null },
    { track: { ...track('recent-2', 'Blinding Lights', 'The Weeknd', 200_000), uri: 'spotify:track:recent2' } }
  ];
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
      case 'GET /v1/me': {
        return route.fulfill({ json: { id: 'max' } });
      }
      case 'GET /v1/me/playlists': {
        return route.fulfill({ json: { items: playlists } });
      }
      case 'GET /v1/me/player/recently-played': {
        return route.fulfill({ json: { items: recentlyPlayed } });
      }
      case 'GET /v1/me/player/devices': {
        return route.fulfill({ json: { devices: [playback.device] } });
      }
      case 'PUT /v1/me/player/play': {
        playback.is_playing = true;
        // A choice from the music picker: a playlist or Liked Songs, or a recently played track.
        const body = (route.request().postDataJSON() ?? {}) as { context_uri?: string; uris?: string[] };
        if (body.context_uri) {
          play(track(`from-${body.context_uri}`, `First of ${body.context_uri}`, 'Someone', 180_000));
        }
        const picked = recentlyPlayed.find(({ track: recent }) => recent.uri === body.uris?.[0]);
        if (picked) play(picked.track);
        return route.fulfill({ status: 204 });
      }
      case 'PUT /v1/me/player/pause': {
        playback.is_playing = false;
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
