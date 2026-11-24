import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../test/deferred';
import { defined } from '../test/defined';
import { FakeWebSocket, fakeSocketCount, latestFakeSocket, resetFakeSockets } from '../test/fakeWebSocket';
import {
  authState,
  queueChanged,
  recordedNow,
  recordedQueue,
  recordedReplies,
  recordedSongs,
  RECORDED_DEVICE_NAME
} from '../test/soloistFixtures';
import type { SpotifyDevice } from '../types';
import { getDevices } from './api';
import { SoloistPlayer, soloistTrack } from './soloistPlayer';
import type { SoloistHandlers } from './soloistPlayer';

vi.mock('./api', () => ({ getDevices: vi.fn() }));

const SOLOIST = { id: 'soloist-1', name: RECORDED_DEVICE_NAME };

function handlers() {
  return {
    onReady: vi.fn<SoloistHandlers['onReady']>(),
    onNotReady: vi.fn<SoloistHandlers['onNotReady']>(),
    onSignedOut: vi.fn<SoloistHandlers['onSignedOut']>(),
    onState: vi.fn<SoloistHandlers['onState']>(),
    onQueue: vi.fn<SoloistHandlers['onQueue']>()
  };
}

/** The commands the page sent, by name, apart from its requests for the queue (counted by queueAsks). */
const commandsSent = (socket: FakeWebSocket) =>
  socket.sent
    .map(frame => (frame as { command?: unknown }).command)
    .filter(command => command !== undefined && command !== 'get_queue');

/** How many times the page asked Soloist for its queue. */
const queueAsks = (socket: FakeWebSocket) =>
  socket.sent.filter(frame => (frame as { command?: unknown }).command === 'get_queue').length;

/** Lets the device lookup answer. */
const settle = () => vi.advanceTimersByTimeAsync(0);

/** A player whose bridge is up and whose Soloist says it is signed in (active or not); not yet looked up. */
function connected(isActive: boolean) {
  const on = handlers();
  const player = new SoloistPlayer(on);
  player.connect();
  const socket = latestFakeSocket();
  socket.open();
  socket.receive({ type: 'bridge', connected: true });
  socket.receive(authState(isActive));
  socket.receive(recordedNow(isActive));
  return { on, player, socket };
}

/** A player that is ready as `soloist-1`. */
async function ready(isActive = true) {
  const setup = connected(isActive);
  await settle();
  expect(setup.on.onReady).toHaveBeenCalledExactlyOnceWith('soloist-1');
  return setup;
}

/** Has the socket answer each command with what the recorded Soloist did. */
function answerAsRecorded(socket: FakeWebSocket) {
  socket.reply = frame => {
    const { command } = frame as { command?: unknown };
    return typeof command === 'string' && command !== 'get_state' ? recordedReplies(command) : [];
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  resetFakeSockets();
  vi.mocked(getDevices).mockReset();
  vi.mocked(getDevices).mockResolvedValue({ devices: [{ id: 'phone', name: 'Phone' }, SOLOIST] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('soloistTrack', () => {
  it('reads a song with its details, its largest cover first', () => {
    expect(soloistTrack(recordedNow(true)['item'])).toEqual({
      id: '342fawASzRGGLF1oFqfhtK',
      uri: 'spotify:track:342fawASzRGGLF1oFqfhtK',
      name: 'Henda mot himmelen',
      artists: [{ name: 'Madeléne' }],
      duration_ms: 205_049,
      album: {
        images: [
          { url: 'https://i.scdn.co/image/ab67616d0000b2739e968fbb14951df3c3fabe22' },
          { url: 'https://i.scdn.co/image/ab67616d0000b2739e968fbb14951df3c3fabe22' },
          { url: 'https://i.scdn.co/image/ab67616d00001e029e968fbb14951df3c3fabe22' },
          { url: 'https://i.scdn.co/image/ab67616d000048519e968fbb14951df3c3fabe22' }
        ]
      }
    });
  });

  it('has no song until its details arrive, and skips what it cannot read', () => {
    const bare = { uri: 'spotify:track:5wlCtqYAIJDDwtytVWi8Ts', decorations: { playback: { duration_ms: 157_209 } } };
    expect(soloistTrack(bare)).toBeUndefined();
    expect(soloistTrack({ uri: '', decorations: { identity: { name: 'Nothing' } } })).toBeUndefined();
    expect(soloistTrack(null)).toBeUndefined();
    const odd = {
      uri: 'spotify:track:odd',
      decorations: {
        identity: { name: 'Odd' },
        visual_identity: { cover: [{ url: 'https://example.com/odd', size: 'huge' }, { size: 'large' }, 'cover'] },
        creators: [{ entity: {} }, { entity: { decorations: { identity: { name: 'Someone' } } } }]
      }
    };
    expect(soloistTrack(odd)).toEqual({
      id: 'odd',
      uri: 'spotify:track:odd',
      name: 'Odd',
      artists: [{ name: 'Someone' }],
      album: { images: [{ url: 'https://example.com/odd' }] }
    });
  });
});

describe('SoloistPlayer', () => {
  it('connects to the kiosk service, asks for the state, and is ready once Spotify lists Soloist', async () => {
    const { on, socket } = connected(false);
    expect(socket.url).toBe('ws://127.0.0.1:7341/soloist');
    expect(socket.sent).toEqual([{ type: 'command', command: 'get_state' }]);
    await settle();
    expect(getDevices).toHaveBeenCalledOnce();
    expect(on.onReady).toHaveBeenCalledExactlyOnceWith('soloist-1');
    // Another sign-in report does not look it up again.
    socket.receive(authState(false));
    await settle();
    expect(getDevices).toHaveBeenCalledOnce();
  });

  it('looks Soloist up again, waiting longer each time, until Spotify lists it', async () => {
    vi.mocked(getDevices)
      .mockResolvedValueOnce({ devices: [] })
      .mockRejectedValueOnce(new Error('Spotify is down'))
      .mockResolvedValueOnce({ devices: [] });
    const { on } = connected(false);
    await settle();
    expect(getDevices).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3000);
    expect(getDevices).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5999);
    expect(getDevices).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(getDevices).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(on.onReady).toHaveBeenCalledExactlyOnceWith('soloist-1');
  });

  it('reports nothing while another device is the active one, and the playback once Soloist is', async () => {
    const { on, socket } = await ready(false);
    expect(on.onState).toHaveBeenLastCalledWith(null);
    socket.receive({ type: 'device_changed', is_active: true, device_name: RECORDED_DEVICE_NAME });
    expect(on.onState.mock.lastCall?.[0]).toMatchObject({
      paused: false,
      duration: 205_049,
      shuffle: false,
      repeat: 'off',
      track: { id: '342fawASzRGGLF1oFqfhtK' }
    });
  });

  it('follows the position, the status, the song and the options as they change', async () => {
    const { on, socket } = await ready();
    vi.setSystemTime(1_000_000);
    socket.receive({ type: 'position_sync', position: { position_ms: 30_000, timestamp_ms: 998_000, speed: 1 } });
    expect(on.onState).toHaveBeenLastCalledWith(expect.objectContaining({ paused: false, position: 32_000 }));
    socket.receive({ type: 'position_sync', position: 'lost' });
    socket.receive({ type: 'playback_changed', status: 'paused' });
    socket.receive({ type: 'position_sync', position: { position_ms: 40_000, timestamp_ms: 998_000, speed: 0 } });
    expect(on.onState).toHaveBeenLastCalledWith(expect.objectContaining({ paused: true, position: 40_000 }));
    socket.receive({ type: 'options_changed', options: { shuffle: true, repeat: 'track' } });
    expect(on.onState).toHaveBeenLastCalledWith(expect.objectContaining({ shuffle: true, repeat: 'track' }));
    socket.receive({ type: 'options_changed', options: { repeat: 'sometimes' } });
    expect(defined(on.onState.mock.lastCall)[0]).not.toHaveProperty('repeat');
    // The first report of a new song comes without its details.
    socket.receive({ type: 'track_changed', item: { uri: 'spotify:track:5wlCtqYAIJDDwtytVWi8Ts' } });
    expect(defined(on.onState.mock.lastCall)[0]).not.toHaveProperty('track');
    socket.receive({ type: 'playback_state', status: 'idle', is_active: true, item: { uri: '' } });
    expect(on.onState).toHaveBeenLastCalledWith({ paused: true, position: 0 });
  });

  describe('the queue', () => {
    const PLACEHOLDER = { item: { uri: 'spotify:meta:node_rules_placeholder' } };
    const tracksOf = (entries: readonly Record<string, unknown>[]) => entries.map(entry => soloistTrack(entry['item']));

    it('asks for the whole queue once it is the active device, and hands on every song of the answer', async () => {
      const { on, socket } = await ready();
      // Without a limit: Soloist then lists every song, not only the first ten.
      expect(socket.sent).toEqual([
        { type: 'command', command: 'get_state' },
        { type: 'command', command: 'get_queue' }
      ]);
      const songs = recordedSongs();
      expect(songs.length).toBeGreaterThan(10);
      socket.receive(queueChanged(songs));
      expect(on.onQueue).toHaveBeenCalledExactlyOnceWith(tracksOf(songs));
      expect(defined(on.onQueue.mock.lastCall)[0]?.[0]).toMatchObject({
        name: 'Alle vil til himmelen',
        artists: [{ name: expect.any(String) as unknown }, { name: expect.any(String) as unknown }],
        album: {
          images: expect.arrayContaining([
            { url: 'https://i.scdn.co/image/ab67616d0000b273abd814fa96253f96aaf8781f' }
          ]) as unknown
        }
      });
      expect(queueAsks(socket)).toBe(1);
    });

    it('asks again for a pushed change, and takes the queue_changed that answers as the answer, as recorded', async () => {
      const { on, socket } = await ready();
      socket.receive(queueChanged([]));
      on.onQueue.mockClear();
      answerAsRecorded(socket);
      const answer = recordedReplies('get_queue').find(message => message['type'] === 'queue_changed');
      // A pushed change lists ten at most; the recorded answer to a get_queue (with a limit of 5) lists five.
      socket.receive(recordedQueue());
      expect(queueAsks(socket)).toBe(2);
      expect(on.onQueue).toHaveBeenCalledExactlyOnceWith(
        tracksOf(defined(answer)['upcoming'] as Record<string, unknown>[])
      );
      // The answer asks nothing more.
      expect(queueAsks(socket)).toBe(2);
    });

    it('asks once for a burst of changes, and takes a longer list than Soloist pushes as an answer', async () => {
      const { on, socket } = await ready();
      const songs = recordedSongs();
      // The first change arrives while the get_queue sent on connecting waits: it is taken as its answer.
      socket.receive(queueChanged(songs.slice(0, 10)));
      expect(on.onQueue).toHaveBeenCalledExactlyOnceWith(tracksOf(songs.slice(0, 10)));
      socket.receive(queueChanged(songs.slice(1, 10)));
      socket.receive(queueChanged(songs.slice(2, 10)));
      expect(queueAsks(socket)).toBe(2);
      // That answer was taken: the next asks again.
      socket.receive(queueChanged(songs.slice(3, 10)));
      expect(queueAsks(socket)).toBe(3);
      // An answer the player has stopped waiting for is still known by its length.
      await vi.advanceTimersByTimeAsync(8000);
      socket.receive(queueChanged(songs));
      expect(on.onQueue).toHaveBeenLastCalledWith(tracksOf(songs));
      expect(queueAsks(socket)).toBe(3);
    });

    it('asks again once an answer never came', async () => {
      const { socket } = await ready();
      socket.receive(queueChanged([]));
      socket.receive(queueChanged(recordedSongs().slice(0, 3)));
      expect(queueAsks(socket)).toBe(2);
      await vi.advanceTimersByTimeAsync(8000);
      socket.receive(queueChanged(recordedSongs().slice(0, 2)));
      expect(queueAsks(socket)).toBe(3);
    });

    it('ignores a queue holding stand-ins, and has nothing to show for songs that lack their details', async () => {
      const { on, socket } = await ready();
      // The answer to the get_queue sent on connecting.
      socket.receive(queueChanged([PLACEHOLDER, ...recordedSongs()]));
      socket.receive({ type: 'queue_changed', upcoming: [PLACEHOLDER] });
      expect(on.onQueue).not.toHaveBeenCalled();
      expect(queueAsks(socket)).toBe(1);
      // The recorded push has songs without their details yet.
      socket.receive(recordedQueue());
      expect(queueAsks(socket)).toBe(2);
      socket.receive(recordedQueue());
      expect(on.onQueue).toHaveBeenCalledExactlyOnceWith(null);
    });

    it('says the queue changed, without asking for it, while another device plays', async () => {
      const { on, socket } = await ready(false);
      socket.receive(recordedQueue());
      socket.receive(queueChanged(recordedSongs()));
      expect(on.onQueue.mock.calls).toEqual([[null], [null]]);
      expect(queueAsks(socket)).toBe(0);
      // Taking playback over reads it whole.
      socket.receive({ type: 'device_changed', is_active: true, device_name: RECORDED_DEVICE_NAME });
      expect(queueAsks(socket)).toBe(1);
      socket.receive({ type: 'device_changed', is_active: true, device_name: RECORDED_DEVICE_NAME });
      expect(queueAsks(socket)).toBe(1);
    });

    it('is not held back by the gate on control commands', async () => {
      const { socket } = await ready(false);
      socket.receive({ type: 'playback_state', is_active: true, status: 'playing' });
      expect(socket.sent.at(-1)).toEqual({ type: 'command', command: 'get_queue' });
    });
  });

  it.each([
    ['play', (player: SoloistPlayer) => player.play(), {}],
    ['pause', (player: SoloistPlayer) => player.pause(), {}],
    ['skip_next', (player: SoloistPlayer) => player.nextTrack(), {}],
    ['skip_prev', (player: SoloistPlayer) => player.previousTrack(), {}],
    ['seek', (player: SoloistPlayer) => player.seek(30_000.4), { position_ms: 30_000 }],
    ['set_volume', (player: SoloistPlayer) => player.setVolume(4.2), { volume: 4 }]
  ] as const)('sends %s and resolves once Soloist took it', async (command, send, fields) => {
    const { player, socket } = await ready();
    answerAsRecorded(socket);
    const before = socket.sent.length;
    await expect(send(player)).resolves.toBeUndefined();
    // A play is followed by the volume set again once it plays.
    expect(socket.sent[before]).toEqual({ type: 'command', command, ...fields });
  });

  it('keeps the seek and the volume in range', async () => {
    const { player, socket } = await ready();
    answerAsRecorded(socket);
    await player.seek(-5);
    await player.setVolume(140);
    expect(socket.sent.slice(-2)).toEqual([
      { type: 'command', command: 'seek', position_ms: 0 },
      { type: 'command', command: 'set_volume', volume: 100 }
    ]);
  });

  it('sends no command while another device is active, as it would reach that device', async () => {
    const { player, socket } = await ready(false);
    await expect(player.pause()).rejects.toThrow('The kiosk player is not the active speaker.');
    expect(commandsSent(socket)).toEqual(['get_state']);
    socket.end();
    await expect(player.play()).rejects.toThrow('The kiosk player is not connected.');
  });

  it('takes an error as the answer to the oldest command, and gives up on one that never answers', async () => {
    const { player, socket } = await ready();
    const first = player.play();
    const second = player.nextTrack();
    socket.receive({ type: 'command_result', command: 'get_state' });
    socket.receive({ type: 'error', message: 'unknown command: play' });
    await expect(first).rejects.toThrow('unknown command: play');
    socket.receive({ type: 'error' });
    await expect(second).rejects.toThrow('The kiosk player refused that.');
    // An error nothing waits for changes nothing.
    socket.receive({ type: 'error', message: 'late' });
    const third = player.pause();
    await Promise.all([
      expect(third).rejects.toThrow('Spotify did not answer. Try again.'),
      vi.advanceTimersByTimeAsync(8000)
    ]);
    socket.receive({ type: 'command_result', command: 'pause' });
  });

  it('puts the volume back when starting playback raised it', async () => {
    const { player, socket } = await ready();
    answerAsRecorded(socket);
    await player.setVolume(4);
    socket.reply = null;
    socket.receive({ type: 'playback_changed', status: 'paused' });
    socket.receive({ type: 'playback_changed', status: 'playing' });
    socket.receive({ type: 'volume_changed', volume: 5 });
    expect(socket.sent.at(-1)).toEqual({ type: 'command', command: 'set_volume', volume: 4 });
    // Once only: a change made later, from a phone, is taken as it is.
    const sent = socket.sent.length;
    socket.receive({ type: 'volume_changed', volume: 9 });
    socket.receive({ type: 'volume_changed', volume: 'loud' });
    vi.advanceTimersByTime(6000);
    socket.receive({ type: 'playback_changed', status: 'paused' });
    socket.receive({ type: 'playback_changed', status: 'buffering' });
    socket.receive({ type: 'volume_changed', volume: 9 });
    expect(socket.sent).toHaveLength(sent);
  });

  it('sets the volume again once a play it sent starts playing, as recorded', async () => {
    const { player, socket } = await ready();
    answerAsRecorded(socket);
    await player.setVolume(4);
    // Soloist was asked to play at 4 (the recorded answer to a volume): it plays, then comes up a step louder.
    socket.reply = frame =>
      (frame as { command?: unknown }).command === 'play'
        ? [
            { type: 'playback_changed', status: 'buffering' },
            { type: 'command_result', command: 'play' }
          ]
        : [];
    const sent = socket.sent.length;
    await player.play();
    expect(socket.sent.slice(sent)).toEqual([{ type: 'command', command: 'play' }]);
    socket.receive({ type: 'volume_changed', volume: 5 });
    socket.receive({ type: 'playback_changed', status: 'playing' });
    expect(socket.sent.slice(sent + 1)).toEqual([{ type: 'command', command: 'set_volume', volume: 4 }]);
    socket.receive({ type: 'volume_changed', volume: 4 });
    // A step up that comes after it, as recorded about 180 ms after the play, is put back too.
    vi.advanceTimersByTime(180);
    socket.receive({ type: 'volume_changed', volume: 5 });
    expect(socket.sent.slice(sent + 1)).toEqual([
      { type: 'command', command: 'set_volume', volume: 4 },
      { type: 'command', command: 'set_volume', volume: 4 }
    ]);
    // Once only: later news that it plays sends nothing more.
    socket.receive({ type: 'volume_changed', volume: 6 });
    socket.receive({ type: 'playback_changed', status: 'paused' });
    socket.receive({ type: 'playback_changed', status: 'playing' });
    expect(socket.sent).toHaveLength(sent + 3);
  });

  it('sets the volume again after a start it was told of, once it is active and playing', async () => {
    const { player, socket } = await ready(false);
    player.expectStart();
    socket.receive({ type: 'playback_changed', status: 'playing' });
    // Not the active device yet: nothing goes, as it would reach the phone.
    expect(commandsSent(socket)).toEqual(['get_state']);
    socket.receive({ type: 'device_changed', is_active: true, device_name: RECORDED_DEVICE_NAME });
    expect(commandsSent(socket)).toEqual(['get_state', 'set_volume']);
  });

  it('forgets a start that never plays', async () => {
    const { player, socket } = await ready();
    player.expectStart();
    vi.advanceTimersByTime(6000);
    socket.receive({ type: 'playback_changed', status: 'playing' });
    expect(commandsSent(socket)).toEqual(['get_state']);
  });

  it('sends nothing to Soloist once another device took over, not even a volume put back', async () => {
    const { player, socket } = await ready();
    answerAsRecorded(socket);
    await player.setVolume(4);
    socket.reply = null;
    const sent = socket.sent.length;
    // The phone takes playback back, as recorded.
    socket.receive({ type: 'device_changed', is_active: false, device_name: RECORDED_DEVICE_NAME });
    socket.receive({ type: 'playback_changed', status: 'paused' });
    socket.receive({ type: 'playback_changed', status: 'playing' });
    socket.receive({ type: 'volume_changed', volume: 5 });
    await expect(player.pause()).rejects.toThrow('The kiosk player is not the active speaker.');
    await expect(player.setVolume(3)).rejects.toThrow('The kiosk player is not the active speaker.');
    expect(socket.sent).toHaveLength(sent);
  });

  it('is no longer ready once Soloist goes, and ready again once it is back', async () => {
    const { on, player, socket } = await ready();
    const pending = player.pause();
    socket.receive({ type: 'bridge', connected: false });
    await expect(pending).rejects.toThrow('The kiosk player disconnected.');
    expect(on.onNotReady).toHaveBeenCalledOnce();
    expect(on.onState).toHaveBeenLastCalledWith(null);
    socket.receive({ type: 'bridge', connected: true });
    socket.receive(authState(true));
    await settle();
    expect(on.onReady).toHaveBeenCalledTimes(2);
  });

  it('is no longer ready when Soloist signs out', async () => {
    const { on, socket } = await ready();
    socket.receive({ type: 'auth_state', logged_in: false, is_active: false, device_name: RECORDED_DEVICE_NAME });
    expect(on.onNotReady).toHaveBeenCalledOnce();
    expect(on.onState).toHaveBeenLastCalledWith(null);
    await settle();
    expect(getDevices).toHaveBeenCalledOnce();
  });

  it('looks up the Soloist that takes the place of another', async () => {
    const { on, socket } = await ready();
    vi.mocked(getDevices).mockResolvedValue({ devices: [{ id: 'soloist-2', name: 'The Max Mix Soloist' }] });
    socket.receive(authState(false, 'The Max Mix Soloist'));
    await settle();
    expect(on.onNotReady).toHaveBeenCalledOnce();
    expect(on.onReady).toHaveBeenLastCalledWith('soloist-2');
  });

  it('says when Soloist waits to be signed in, and looks it up once someone does', async () => {
    const on = handlers();
    const player = new SoloistPlayer(on);
    player.connect();
    const socket = latestFakeSocket();
    socket.open();
    socket.receive({ type: 'bridge', connected: true });
    socket.receive({ ...authState(false), logged_in: false });
    await settle();
    expect(on.onSignedOut).toHaveBeenCalledOnce();
    expect(getDevices).not.toHaveBeenCalled();
    socket.receive(authState(false));
    await settle();
    expect(on.onReady).toHaveBeenCalledExactlyOnceWith('soloist-1');
    expect(on.onSignedOut).toHaveBeenCalledOnce();
  });

  it('drops a lookup that Soloist went away during', async () => {
    const lookup = deferred<{ devices: SpotifyDevice[] }>();
    vi.mocked(getDevices).mockReturnValueOnce(lookup.promise);
    const { on, socket } = connected(false);
    socket.receive({ type: 'bridge', connected: false });
    lookup.resolve({ devices: [SOLOIST] });
    await settle();
    expect(on.onReady).not.toHaveBeenCalled();
  });

  it('connects again a while after the connection drops', async () => {
    const { on, socket } = await ready();
    socket.end();
    expect(on.onNotReady).toHaveBeenCalledOnce();
    expect(fakeSocketCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fakeSocketCount()).toBe(2);
    expect(latestFakeSocket()).not.toBe(socket);
  });

  it('asks for the state again on a refresh, or connects at once when the connection is down', async () => {
    const { player, socket } = await ready();
    player.refresh();
    expect(commandsSent(socket)).toEqual(['get_state', 'get_state']);
    socket.end();
    player.refresh();
    expect(fakeSocketCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fakeSocketCount()).toBe(2);
  });

  it('looks the device up again on request', async () => {
    const { on, player } = await ready();
    vi.mocked(getDevices).mockResolvedValue({ devices: [{ id: 'soloist-3', name: RECORDED_DEVICE_NAME }] });
    await expect(player.refreshDevice()).resolves.toBe('soloist-3');
    expect(on.onReady).toHaveBeenLastCalledWith('soloist-3');
    vi.mocked(getDevices).mockResolvedValue({ devices: [] });
    await expect(player.refreshDevice()).resolves.toBeNull();
  });

  it('ignores what is not a message of its own', async () => {
    const { on, socket } = await ready();
    const calls = on.onState.mock.calls.length;
    socket.receive('not json');
    socket.receive('[1, 2]');
    socket.receive({ type: 'context_changed' });
    socket.receive({ type: 'command_result', command: 'play' });
    expect(on.onState).toHaveBeenCalledTimes(calls);
  });

  it('says nothing more and stays closed once disconnected', async () => {
    const { on, player, socket } = await ready();
    const pending = player.play();
    player.disconnect();
    await expect(pending).rejects.toThrow('The kiosk player disconnected.');
    expect(socket.isClosed).toBe(true);
    socket.receive(recordedNow(true));
    player.refresh();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fakeSocketCount()).toBe(1);
    expect(on.onNotReady).not.toHaveBeenCalled();
    // Connecting again starts afresh.
    player.connect();
    player.connect();
    expect(fakeSocketCount()).toBe(2);
  });
});
