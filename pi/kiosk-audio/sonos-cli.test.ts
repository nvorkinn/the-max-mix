/* eslint-disable sonarjs/no-clear-text-protocols -- a speaker serves its artwork over plain http, by design */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cliOperations,
  failureMessage,
  groupsCommand,
  parseCliGroups,
  parseCliStatus,
  sonosCommand
} from './sonos-cli.ts';
import type { RunCli } from './sonos-cli.ts';

const URI = 'spotify:track:1234567890123456789012';
const ENCODED = ['x-sonos-spotify:spotify', 'track', '1234567890123456789012?sid=9'].join('%3a');

const GROUPS = JSON.stringify({
  groups: [
    {
      id: 'RINCON_K:5',
      coordinator: { name: 'Kitchen', uuid: 'RINCON_K' },
      members: [
        { name: 'Lounge', uuid: 'RINCON_L', isCoordinator: false },
        { name: 'Kitchen', uuid: 'RINCON_K', isCoordinator: true },
        { name: '', uuid: 'RINCON_X' }
      ]
    },
    { id: '', members: [] },
    { id: 'RINCON_B:1', members: 'none' }
  ]
});
const STATUS = JSON.stringify({
  device: { ip: '192.0.2.4', name: 'Kitchen' },
  transport: { State: 'PLAYING' },
  position: { TrackURI: ENCODED, TrackDuration: '0:03:20', RelTime: '0:01:05' },
  nowPlaying: { title: 'Song', artist: 'Band', album: 'Record', uri: ENCODED },
  albumArtURL: 'http://192.0.2.4:1400/getaa?s=1',
  volume: 12
});

const elsewhere: RunCli = () =>
  Promise.resolve({
    code: 0,
    stdout: JSON.stringify({ device: { ip: '192.0.2.4' }, albumArtURL: 'http://evil.example/x.jpg' }),
    stderr: ''
  });
const none: RunCli = () => Promise.resolve({ code: 0, stdout: '{}', stderr: '' });

/** A fake sonoscli: answers by the command, and fails for the room Attic. */
function fakeRun(): RunCli & ReturnType<typeof vi.fn> {
  return vi.fn((argv: string[]) => {
    if (argv.includes('--name=Attic')) {
      return Promise.resolve({ code: 1, stderr: 'Error: speaker name not found in topology: Attic\n' });
    }
    let stdout = '';
    if (argv[1] === 'status') stdout = STATUS;
    else if (argv[2] === 'volume') stdout = '{"volume": 35}';
    else if (argv[2] === 'status') stdout = GROUPS;
    return Promise.resolve({ code: 0, stdout, stderr: '' });
  });
}

describe('sonoscli', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs each call with the room as one argument, and a URI after --', async () => {
    const run = fakeRun();
    const cli = cliOperations(run);
    await cli.play('Living Room', URI);
    await cli.control('Kitchen', 'previous', 0);
    await cli.volume('Kitchen', 30);
    await cli.joinGroup('Lounge', 'Kitchen');
    await cli.leaveGroup('Lounge');
    const argv = (call: number) => (run.mock.calls[call] as [string[]])[0].slice(1);
    expect(argv(0)).toEqual(['open', '--name=Living Room', '--timeout=15s', '--', URI]);
    expect(argv(1)).toEqual(['prev', '--name=Kitchen', '--timeout=15s']);
    expect(argv(2)).toEqual(['group', 'volume', 'set', '30', '--name=Kitchen', '--timeout=15s']);
    expect(argv(3)).toEqual(['group', 'join', '--to=Kitchen', '--name=Lounge', '--timeout=15s']);
    expect(argv(4)).toEqual(['group', 'unjoin', '--name=Lounge', '--timeout=15s']);
    expect(sonosCommand({ room: 'Kitchen', uri: URI })[0]).toBe('/usr/local/bin/sonos');
  });

  it('cannot seek, and says why a call failed', async () => {
    vi.spyOn(console, 'warn').mockReturnValue();
    const cli = cliOperations(fakeRun());
    await expect(cli.control('Kitchen', 'seek', 1000)).rejects.toThrow('cannot move to a point in the song');
    await expect(cli.play('Attic', URI)).rejects.toThrow('Sonos: speaker name not found in topology: Attic');
    expect(failureMessage('\n')).toBe('Sonos did not do that.');
  });

  it('lists the groups from `sonos group status`, the leading room first', async () => {
    const run = fakeRun();
    await expect(cliOperations(run).groups()).resolves.toEqual([
      {
        id: 'RINCON_K:5',
        rooms: [
          { id: 'RINCON_K', name: 'Kitchen' },
          { id: 'RINCON_L', name: 'Lounge' }
        ]
      }
    ]);
    expect(run).toHaveBeenCalledWith(groupsCommand);
    expect(parseCliGroups('{"groups": []}')).toEqual([]);
    expect(() => parseCliGroups('{}')).toThrow('sonoscli did not say which groups there are');
    expect(() => parseCliGroups('not json')).toThrow('sonoscli did not say which groups there are');
  });

  it('says what plays from `sonos status` and the group volume', async () => {
    await expect(cliOperations(fakeRun()).now('Kitchen')).resolves.toEqual({
      playing: true,
      positionMs: 65_000,
      track: { name: 'Song', artist: 'Band', album: 'Record', durationMs: 200_000, uri: URI, art: true },
      volume: 35,
      canSeek: false
    });
    const idle = parseCliStatus(JSON.stringify({ transport: { State: 'STOPPED' } }), '{}');
    expect(idle).toEqual({ playing: false, positionMs: 0, track: null, volume: null, canSeek: false });
  });

  it('fetches the artwork from the speaker that plays, and nowhere else', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('jpeg', { headers: { 'Content-Type': 'image/jpeg' } })));
    vi.stubGlobal('fetch', fetchMock);
    const art = await cliOperations(fakeRun()).art('Kitchen');
    expect(art?.type).toBe('image/jpeg');
    expect(art?.body.toString()).toBe('jpeg');
    expect((fetchMock.mock.calls[0] as unknown as [URL])[0].href).toBe('http://192.0.2.4:1400/getaa?s=1');

    await expect(cliOperations(elsewhere).art('Kitchen')).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(new Response('<html>', { headers: { 'Content-Type': 'text/html' } }));
    await expect(cliOperations(fakeRun()).art('Kitchen')).resolves.toBeNull();
    await expect(cliOperations(none).art('Kitchen')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
