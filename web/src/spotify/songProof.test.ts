import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as auth from './auth';
import { pauseFor, playingTrackIdOf } from './songProof';
import { resetSpotifyRateLimit } from './http';

vi.mock('./auth', () => ({ getAccessTokenFor: vi.fn() }));

describe('spotify/songProof', () => {
  let fetchMock: Mock;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(auth.getAccessTokenFor).mockResolvedValue('olav-token');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetSpotifyRateLimit();
  });

  it('reads what plays on that person’s account with their own token', async () => {
    fetchMock.mockResolvedValue(Response.json({ is_playing: true, item: { id: 'song-1' } }));
    await expect(playingTrackIdOf('olav')).resolves.toBe('song-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.spotify.com/v1/me/player/currently-playing');
    expect(init.headers).toEqual({ Authorization: 'Bearer olav-token' });
    expect(auth.getAccessTokenFor).toHaveBeenCalledWith('olav');
  });

  it('is null when nothing plays, the song is paused, or the person is unknown', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(playingTrackIdOf('olav')).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(Response.json({ is_playing: false, item: { id: 'song-1' } }));
    await expect(playingTrackIdOf('olav')).resolves.toBeNull();
    vi.mocked(auth.getAccessTokenFor).mockResolvedValue(null);
    await expect(playingTrackIdOf('nobody')).resolves.toBeNull();
    await pauseFor('nobody');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('pauses that person’s playback', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await pauseFor('olav');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.spotify.com/v1/me/player/pause');
    expect(init.method).toBe('PUT');
  });
});
