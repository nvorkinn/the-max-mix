// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  failureMessage,
  parseSonosPlay,
  parseSonosTest,
  playOnSonos,
  resumeCommand,
  SonosError,
  sonosCommand,
  testOnSonos
} from './sonos.ts';
import type { SonosWays } from './sonos.ts';

const URI = 'spotify:track:1234567890123456789012';
const noRoom = () => Promise.reject(new Error('no room called Attic on this network.'));
const notFound = () => Promise.resolve({ code: 1, stderr: 'Error: speaker name not found in topology: Attic\n' });

function ways(overrides: Partial<SonosWays> = {}): SonosWays {
  return {
    run: vi.fn(() => Promise.resolve({ code: 0, stderr: '' })),
    play: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
    ...overrides
  };
}

describe('parseSonosPlay', () => {
  it('takes a room name, a Spotify URI and which way to play it (sonoscli by default)', () => {
    expect(parseSonosPlay({ room: ' Living Room ', uri: URI })).toEqual({
      room: 'Living Room',
      uri: URI,
      engine: 'cli'
    });
    expect(parseSonosPlay({ room: 'Kitchen', uri: URI, engine: 'library' })?.engine).toBe('library');
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
      { room: 'Kitchen', uri: URI, engine: 'shell' },
      { room: 'Kitchen', uri: 'https://open.spotify.com/track/1234567890123456789012' },
      { room: 'Kitchen', uri: 'spotify:artist:1234567890123456789012' },
      { room: 'Kitchen', uri: `${URI} --debug` }
    ]) {
      expect(parseSonosPlay(body)).toBeNull();
    }
  });
});

describe('parseSonosTest', () => {
  it('takes a room and one of the two test calls', () => {
    expect(parseSonosTest({ room: 'Kitchen', test: 'cli-play' })).toEqual({ room: 'Kitchen', test: 'cli-play' });
    expect(parseSonosTest({ room: 'Kitchen', test: 'library-queue' })).not.toBeNull();
    expect(parseSonosTest({ room: 'Kitchen', test: 'other' })).toBeNull();
    expect(parseSonosTest({ room: '-x', test: 'cli-play' })).toBeNull();
    expect(parseSonosTest(null)).toBeNull();
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
    expect(resumeCommand('Living Room')).toEqual([
      '/usr/local/bin/sonos',
      'play',
      '--name=Living Room',
      '--timeout=15s'
    ]);
  });
});

describe('playOnSonos', () => {
  it('runs sonoscli, or the library when asked', async () => {
    const fakes = ways();
    await playOnSonos({ room: 'Kitchen', uri: URI, engine: 'cli' }, fakes);
    expect(fakes.run).toHaveBeenCalledWith(sonosCommand({ room: 'Kitchen', uri: URI }));
    await playOnSonos({ room: 'Kitchen', uri: URI, engine: 'library' }, fakes);
    expect(fakes.play).toHaveBeenCalledWith('Kitchen', URI);
  });

  it('rejects with sonoscli’s reason', async () => {
    vi.spyOn(console, 'warn').mockReturnValue();
    const failure = playOnSonos({ room: 'Attic', uri: URI, engine: 'cli' }, ways({ run: notFound }));
    await expect(failure).rejects.toBeInstanceOf(SonosError);
    await expect(failure).rejects.toThrow('Sonos: speaker name not found in topology: Attic');
  });

  it('rejects with the library’s reason', async () => {
    vi.spyOn(console, 'warn').mockReturnValue();
    const failure = playOnSonos({ room: 'Attic', uri: URI, engine: 'library' }, ways({ play: noRoom }));
    await expect(failure).rejects.toThrow('Sonos: no room called Attic on this network.');
  });
});

describe('testOnSonos', () => {
  it('runs `sonos play`, or SwitchToQueue through the library', async () => {
    const fakes = ways();
    await testOnSonos('Kitchen', 'cli-play', fakes);
    expect(fakes.run).toHaveBeenCalledWith(resumeCommand('Kitchen'));
    await testOnSonos('Kitchen', 'library-queue', fakes);
    expect(fakes.resume).toHaveBeenCalledWith('Kitchen');
  });
});

describe('failureMessage', () => {
  it('falls back to a plain message when sonoscli said nothing', () => {
    expect(failureMessage('\n')).toBe('Sonos did not start playing.');
  });
});
