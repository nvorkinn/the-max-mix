// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { guarded, parseRoom, parseSonosRequest, runSonosRequest, SonosError } from './sonos.ts';
import type { SonosOperations } from './sonos.ts';

const URI = 'spotify:track:1234567890123456789012';

function operations(): SonosOperations {
  return {
    groups: vi.fn(() => Promise.resolve([])),
    play: vi.fn(() => Promise.resolve()),
    upNext: vi.fn(() => Promise.resolve(['spotify:track:0000000000000000000009'])),
    now: vi.fn(() => Promise.reject(new Error('no room called Attic on this network.'))),
    control: vi.fn(() => Promise.resolve()),
    volume: vi.fn(() => Promise.resolve()),
    joinGroup: vi.fn(() => Promise.resolve()),
    leaveGroup: vi.fn(() => Promise.reject(new SonosError('Sonos: speaker name not found in topology: Attic'))),
    art: vi.fn(() => Promise.resolve(null))
  };
}

describe('parsing Sonos requests', () => {
  it('takes a room name as the Sonos app shows it', () => {
    expect(parseRoom(' Living Room ')).toBe('Living Room');
    for (const room of [null, '', 'x'.repeat(65), 'Kitchen\n--debug', '--ip=10.0.0.1']) {
      expect(parseRoom(room)).toBeNull();
    }
  });

  it('takes each kind of request', () => {
    expect(parseSonosRequest('play', { room: 'Kitchen', uri: URI })).toEqual({
      kind: 'play',
      room: 'Kitchen',
      uri: URI,
      next: [],
      positionMs: 0
    });
    expect(parseSonosRequest('play', { room: 'Kitchen', uri: URI, next: [URI], positionMs: 61_000.4 })).toMatchObject({
      next: [URI],
      positionMs: 61_000
    });
    expect(parseSonosRequest('play', { room: 'Arc Ultra', uri: URI, queueFrom: 'Kitchen' })).toMatchObject({
      queueFrom: 'Kitchen'
    });
    expect(parseSonosRequest('control', { room: 'Kitchen', action: 'seek', positionMs: 1500.4 })).toEqual({
      kind: 'control',
      room: 'Kitchen',
      action: 'seek',
      positionMs: 1500
    });
    expect(parseSonosRequest('control', { room: 'Kitchen', action: 'next' })).toMatchObject({ positionMs: 0 });
    expect(parseSonosRequest('volume', { room: 'Kitchen', volume: 30 })).toMatchObject({ volume: 30 });
    expect(parseSonosRequest('join', { room: 'Kitchen', to: 'Lounge' })).toMatchObject({ to: 'Lounge' });
    expect(parseSonosRequest('leave', { room: 'Kitchen' })).toEqual({ kind: 'leave', room: 'Kitchen' });
  });

  it('refuses anything else', () => {
    for (const [kind, body] of [
      ['play', null],
      ['play', { room: 'Kitchen' }],
      ['play', { room: '--ip=10.0.0.1', uri: URI }],
      ['play', { room: 'Kitchen', uri: 'https://open.spotify.com/track/1234567890123456789012' }],
      ['play', { room: 'Kitchen', uri: 'spotify:artist:1234567890123456789012' }],
      ['play', { room: 'Kitchen', uri: URI, next: ['spotify:album:1234567890123456789012'] }],
      ['play', { room: 'Kitchen', uri: URI, next: Array.from({ length: 51 }, () => URI) }],
      ['play', { room: 'Kitchen', uri: URI, positionMs: -5 }],
      ['play', { room: 'Kitchen', uri: URI, queueFrom: '--ip=10.0.0.1' }],
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
});

describe('runSonosRequest', () => {
  it('sends each request to its call', async () => {
    const fake = operations();
    vi.spyOn(console, 'info').mockReturnValue();
    await runSonosRequest({ kind: 'play', room: 'Kitchen', uri: URI, next: [URI], positionMs: 9 }, fake);
    await runSonosRequest({ kind: 'control', room: 'Kitchen', action: 'seek', positionMs: 5 }, fake);
    await runSonosRequest({ kind: 'volume', room: 'Kitchen', volume: 30 }, fake);
    await runSonosRequest({ kind: 'join', room: 'Kitchen', to: 'Lounge' }, fake);
    expect(fake.play).toHaveBeenCalledWith('Kitchen', URI, [URI], 9);
    expect(fake.control).toHaveBeenCalledWith('Kitchen', 'seek', 5);
    expect(fake.volume).toHaveBeenCalledWith('Kitchen', 30);
    expect(fake.joinGroup).toHaveBeenCalledWith('Kitchen', 'Lounge');
  });

  it('carries the queue of the group the music moves from', async () => {
    const fake = operations();
    vi.spyOn(console, 'info').mockReturnValue();
    await runSonosRequest(
      { kind: 'play', room: 'Arc Ultra', uri: URI, next: [], positionMs: 9, queueFrom: 'Kitchen' },
      fake
    );
    expect(fake.upNext).toHaveBeenCalledWith('Kitchen', 50);
    expect(fake.play).toHaveBeenCalledWith('Arc Ultra', URI, ['spotify:track:0000000000000000000009'], 9);
    expect(console.info).toHaveBeenCalledWith(
      `sonos: playing ${URI} on Arc Ultra, 1 songs after it from Kitchen's queue`
    );
  });

  it('rejects with a reason safe to show', async () => {
    vi.spyOn(console, 'warn').mockReturnValue();
    const way = guarded(operations());
    await expect(runSonosRequest({ kind: 'leave', room: 'Attic' }, way)).rejects.toThrow(
      'Sonos: speaker name not found in topology: Attic'
    );
    const failure = way.now('Attic');
    await expect(failure).rejects.toBeInstanceOf(SonosError);
    await expect(failure).rejects.toThrow('Sonos: no room called Attic on this network.');
    await expect(way.art('Kitchen')).resolves.toBeNull();
  });
});
