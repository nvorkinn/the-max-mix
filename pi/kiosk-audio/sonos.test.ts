// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { failureMessage, parseSonosPlay, playOnSonos, SonosError, sonosCommand } from './sonos.ts';

const URI = 'spotify:track:1234567890123456789012';
const notFound = () => Promise.resolve({ code: 1, stderr: 'Error: speaker name not found in topology: Attic\n' });

describe('parseSonosPlay', () => {
  it('takes a room name and a Spotify URI', () => {
    expect(parseSonosPlay({ room: ' Living Room ', uri: URI })).toEqual({ room: 'Living Room', uri: URI });
    expect(parseSonosPlay({ room: 'Kitchen', uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' })).not.toBeNull();
  });

  it('refuses anything else', () => {
    for (const body of [
      null,
      'Kitchen',
      { room: 'Kitchen' },
      { room: '', uri: URI },
      { room: 'x'.repeat(65), uri: URI },
      { room: 'Kitchen\n--debug', uri: URI },
      { room: '--ip=10.0.0.1', uri: URI },
      { room: 'Kitchen', uri: 'https://open.spotify.com/track/1234567890123456789012' },
      { room: 'Kitchen', uri: 'spotify:artist:1234567890123456789012' },
      { room: 'Kitchen', uri: `${URI} --debug` }
    ]) {
      expect(parseSonosPlay(body)).toBeNull();
    }
  });
});

describe('sonosCommand', () => {
  it('runs sonoscli with the room as one argument and the URI after --', () => {
    expect(sonosCommand({ room: 'Living Room', uri: URI })).toEqual([
      '/usr/local/bin/sonos',
      'open',
      '--name=Living Room',
      '--timeout=15s',
      '--',
      URI
    ]);
  });
});

describe('playOnSonos', () => {
  it('resolves when sonoscli succeeds', async () => {
    const run = vi.fn(() => Promise.resolve({ code: 0, stderr: '' }));
    await playOnSonos({ room: 'Kitchen', uri: URI }, run);
    expect(run).toHaveBeenCalledWith(sonosCommand({ room: 'Kitchen', uri: URI }));
  });

  it('rejects with the CLI’s reason', async () => {
    vi.spyOn(console, 'warn').mockReturnValue();
    const failure = playOnSonos({ room: 'Attic', uri: URI }, notFound);
    await expect(failure).rejects.toBeInstanceOf(SonosError);
    await expect(failure).rejects.toThrow('Sonos: speaker name not found in topology: Attic');
  });
});

describe('failureMessage', () => {
  it('falls back to a plain message when sonoscli said nothing', () => {
    expect(failureMessage('\n')).toBe('Sonos did not start playing.');
  });
});
