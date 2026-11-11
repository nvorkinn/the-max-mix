import { afterEach, describe, expect, it, vi } from 'vitest';
import { playOnSonosRoom } from './kiosk';

const URI = 'spotify:track:6NmXV4o6bmp704aPGyTVVG';

describe('playOnSonosRoom', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the kiosk to play the song on the room', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await playOnSonosRoom('Kitchen', URI);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:7341/sonos/play',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ room: 'Kitchen', uri: URI }) })
    );
  });

  it('passes on the kiosk’s reason', async () => {
    const body = JSON.stringify({ error: 'Sonos: speaker name not found in topology: Attic' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 502 })));
    await expect(playOnSonosRoom('Attic', URI)).rejects.toThrow('Sonos: speaker name not found in topology: Attic');
  });

  it('says when the song cannot go to Sonos, or the Pi is not updated yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 400 })));
    await expect(playOnSonosRoom('Kitchen', 'spotify:local:x')).rejects.toThrow('can’t be played on Sonos');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(playOnSonosRoom('Kitchen', URI)).rejects.toThrow('Update it in Settings');
  });

  it('says when the kiosk does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(playOnSonosRoom('Kitchen', URI)).rejects.toThrow('did not answer: Failed to fetch');
  });
});
