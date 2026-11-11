// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  parseEngine,
  parseRoom,
  parseSonosRequest,
  parseSonosTest,
  runSonosRequest,
  SonosError,
  sonosWay,
  testOnSonos
} from './sonos.ts';
import type { SonosOperations, SonosWays } from './sonos.ts';

const URI = 'spotify:track:1234567890123456789012';

function operations(): SonosOperations {
  return {
    groups: vi.fn(() => Promise.resolve([])),
    play: vi.fn(() => Promise.resolve()),
    now: vi.fn(() => Promise.reject(new Error('no room called Attic on this network.'))),
    control: vi.fn(() => Promise.resolve()),
    volume: vi.fn(() => Promise.resolve()),
    joinGroup: vi.fn(() => Promise.resolve()),
    leaveGroup: vi.fn(() => Promise.reject(new SonosError('Sonos: speaker name not found in topology: Attic'))),
    art: vi.fn(() => Promise.resolve(null))
  };
}

function ways(): SonosWays {
  return {
    cli: operations(),
    library: operations(),
    run: vi.fn(() => Promise.resolve({ code: 0, stderr: '' })),
    resume: vi.fn(() => Promise.reject(new Error('no speakers answered')))
  };
}

describe('parsing Sonos requests', () => {
  it('takes a room name as the Sonos app shows it', () => {
    expect(parseRoom(' Living Room ')).toBe('Living Room');
    for (const room of [null, '', 'x'.repeat(65), 'Kitchen\n--debug', '--ip=10.0.0.1']) {
      expect(parseRoom(room)).toBeNull();
    }
  });

  it('takes sonoscli or the library as the way, sonoscli when none is named', () => {
    const engines = [undefined, null, 'cli', 'library', 'shell'].map(value => parseEngine(value));
    expect(engines).toEqual(['cli', 'cli', 'cli', 'library', null]);
  });

  it('takes each kind of request', () => {
    expect(parseSonosRequest('play', { room: 'Kitchen', uri: URI, engine: 'library' })).toEqual({
      kind: 'play',
      engine: 'library',
      room: 'Kitchen',
      uri: URI
    });
    expect(parseSonosRequest('control', { room: 'Kitchen', action: 'seek', positionMs: 1500.4 })).toEqual({
      kind: 'control',
      engine: 'cli',
      room: 'Kitchen',
      action: 'seek',
      positionMs: 1500
    });
    expect(parseSonosRequest('control', { room: 'Kitchen', action: 'next' })).toMatchObject({ positionMs: 0 });
    expect(parseSonosRequest('volume', { room: 'Kitchen', volume: 30 })).toMatchObject({ volume: 30 });
    expect(parseSonosRequest('join', { room: 'Kitchen', to: 'Lounge' })).toMatchObject({ to: 'Lounge' });
    expect(parseSonosRequest('leave', { room: 'Kitchen' })).toEqual({ kind: 'leave', engine: 'cli', room: 'Kitchen' });
  });

  it('refuses anything else', () => {
    for (const [kind, body] of [
      ['play', null],
      ['play', { room: 'Kitchen' }],
      ['play', { room: 'Kitchen', uri: URI, engine: 'shell' }],
      ['play', { room: '--ip=10.0.0.1', uri: URI }],
      ['play', { room: 'Kitchen', uri: 'https://open.spotify.com/track/1234567890123456789012' }],
      ['play', { room: 'Kitchen', uri: 'spotify:artist:1234567890123456789012' }],
      ['control', { room: 'Kitchen', action: 'stop' }],
      ['control', { room: 'Kitchen', action: 'seek', positionMs: -1 }],
      ['volume', { room: 'Kitchen', volume: 101 }],
      ['volume', { room: 'Kitchen', volume: 5.5 }],
      ['join', { room: 'Kitchen', to: '-x' }],
      ['other', { room: 'Kitchen' }]
    ] as const) {
      expect(parseSonosRequest(kind, body)).toBeNull();
    }
  });

  it('takes a room and one of the two test calls', () => {
    expect(parseSonosTest({ room: 'Kitchen', test: 'cli-play' })).toEqual({ room: 'Kitchen', test: 'cli-play' });
    expect(parseSonosTest({ room: 'Kitchen', test: 'library-queue' })).not.toBeNull();
    expect(parseSonosTest({ room: 'Kitchen', test: 'other' })).toBeNull();
    expect(parseSonosTest(null)).toBeNull();
  });
});

describe('runSonosRequest', () => {
  it('sends each request the chosen way', async () => {
    const fake = ways();
    await runSonosRequest({ kind: 'play', engine: 'cli', room: 'Kitchen', uri: URI }, fake);
    await runSonosRequest({ kind: 'control', engine: 'library', room: 'Kitchen', action: 'seek', positionMs: 5 }, fake);
    await runSonosRequest({ kind: 'volume', engine: 'library', room: 'Kitchen', volume: 30 }, fake);
    await runSonosRequest({ kind: 'join', engine: 'cli', room: 'Kitchen', to: 'Lounge' }, fake);
    expect(fake.cli.play).toHaveBeenCalledWith('Kitchen', URI);
    expect(fake.library.control).toHaveBeenCalledWith('Kitchen', 'seek', 5);
    expect(fake.library.volume).toHaveBeenCalledWith('Kitchen', 30);
    expect(fake.cli.joinGroup).toHaveBeenCalledWith('Kitchen', 'Lounge');
  });

  it('rejects with a reason safe to show', async () => {
    vi.spyOn(console, 'warn').mockReturnValue();
    const fake = ways();
    await expect(runSonosRequest({ kind: 'leave', engine: 'cli', room: 'Attic' }, fake)).rejects.toThrow(
      'Sonos: speaker name not found in topology: Attic'
    );
    const failure = sonosWay('library', fake).now('Attic');
    await expect(failure).rejects.toBeInstanceOf(SonosError);
    await expect(failure).rejects.toThrow('Sonos: no room called Attic on this network.');
    await expect(sonosWay('library', fake).art('Kitchen')).resolves.toBeNull();
  });
});

describe('testOnSonos', () => {
  it('runs `sonos play`, or SwitchToQueue through the library, and says why it failed', async () => {
    vi.spyOn(console, 'warn').mockReturnValue();
    const fake = ways();
    await testOnSonos('Kitchen', 'cli-play', fake);
    expect(fake.run).toHaveBeenCalledWith(['/usr/local/bin/sonos', 'play', '--name=Kitchen', '--timeout=15s']);
    await expect(testOnSonos('Kitchen', 'library-queue', fake)).rejects.toThrow('Sonos: no speakers answered');
    expect(fake.resume).toHaveBeenCalledWith('Kitchen');
  });
});
