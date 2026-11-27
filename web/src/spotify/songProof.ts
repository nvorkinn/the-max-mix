// The switcher's fallback for someone whose phone the Pi does not hear: the kiosk shows a random song, and once that
// song plays on their Spotify account they have shown the account is theirs. The kiosk only watches; it never starts the
// song itself, or anyone could switch by waiting.
import { getAccessTokenFor } from './auth';
import { fetchSpotify, readJson } from './http';
import { recordOf } from './parse';

/** The ID of the song playing on the account of `spotifyId` now, or null when nothing plays (or Spotify cannot say). */
export async function playingTrackIdOf(spotifyId: string): Promise<string | null> {
  const token = await getAccessTokenFor(spotifyId);
  if (!token) return null;
  const response = await fetchSpotify('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (response.status !== 200) return null;
  const { is_playing: isPlaying, item } = recordOf(await readJson(response));
  const id = recordOf(item)['id'];
  return isPlaying === true && typeof id === 'string' ? id : null;
}

/** Pauses what plays on the account of `spotifyId` (the proof song, so it does not play on beside the kiosk). */
export async function pauseFor(spotifyId: string): Promise<void> {
  const token = await getAccessTokenFor(spotifyId);
  if (!token) return;
  await fetchSpotify('https://api.spotify.com/v1/me/player/pause', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` }
  });
}
