import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { FakeWebSocket, fakeSocketCount, latestFakeSocket, resetFakeSockets } from '../test/fakeWebSocket';
import { authState, recordedNow, recordedQueue, recordedReplies, RECORDED_DEVICE_NAME } from '../test/soloistFixtures';
import { resetSpotifyMocks } from '../test/spotifyMocks';
import { recordSpotifyRetryAfter, SpotifyApiError } from '../spotify/http';
import * as soloist from '../countdown/soloist';
import { useSpotifyPlayer } from './useSpotifyPlayer';

const mocks = await vi.hoisted(async () => {
  const { createSpotifyMocks } = await import('../test/spotifyMocks');
  return createSpotifyMocks();
});
vi.mock('../spotify/api', () => mocks.api);
vi.mock('../spotify/auth', () => mocks.auth);
vi.mock('../spotify/settings', () => mocks.settings);

/** How Spotify lists the kiosk's Soloist. */
const SOLOIST = { id: 'soloist-1', name: RECORDED_DEVICE_NAME };

const webState = (deviceId: string, isPlaying = true) => ({
  is_playing: isPlaying,
  progress_ms: 1000,
  item: { id: 't1', name: 'Song t1', duration_ms: 200_000 },
  device: { id: deviceId, name: 'Somewhere' }
});

const choice = { uri: 'spotify:playlist:p', name: 'Road trip' };

/**
 * Has Soloist answer get_state with its state, as the active device or not, and every other command as the recorded one
 * did.
 */
function answerAsSoloist(socket: FakeWebSocket, isActive: boolean) {
  socket.reply = frame => {
    const { command } = frame as { command?: unknown };
    if (command === 'get_state') return [authState(isActive), recordedNow(isActive)];
    return typeof command === 'string' ? recordedReplies(command) : [];
  };
}

/** The commands the page sent Soloist, apart from its requests for the state. */
const commandsSent = (socket: FakeWebSocket) =>
  socket.sent
    .map(frame => (frame as { command?: unknown }).command)
    .filter(command => command !== undefined && command !== 'get_state');

/** The service connects the page to Soloist. */
function joinSoloist(isActive: boolean) {
  const socket = latestFakeSocket();
  answerAsSoloist(socket, isActive);
  act(() => {
    socket.open();
    socket.receive({ type: 'bridge', connected: true });
  });
  return socket;
}

/** The hook with the kiosk's player ready as `soloist-1`, active or not. */
async function ready(isActive = false) {
  const hook = renderHook(() => useSpotifyPlayer());
  const socket = joinSoloist(isActive);
  await waitFor(() => expect(hook.result.current.browserDeviceId).toBe('soloist-1'));
  return { ...hook, socket };
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** The same as `ready`, under fake timers. */
async function readyWithFakeTimers(isActive = false) {
  vi.useFakeTimers();
  const hook = renderHook(() => useSpotifyPlayer());
  await advance(0);
  const socket = joinSoloist(isActive);
  await advance(0);
  expect(hook.result.current.browserDeviceId).toBe('soloist-1');
  return { ...hook, socket };
}

const playbackCalls = () => mocks.api.getPlaybackState.mock.calls.length;

beforeEach(() => {
  resetSpotifyMocks(mocks);
  resetFakeSockets();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  mocks.api.getPlaybackState.mockResolvedValue(webState('soloist-1'));
  mocks.api.getDevices.mockResolvedValue({ devices: [{ id: 'phone', name: 'Phone' }, SOLOIST] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useSpotifyPlayer with the kiosk player', () => {
  it('connects to Soloist through the kiosk service and offers it as the device', async () => {
    const { result } = renderHook(() => useSpotifyPlayer());
    expect(latestFakeSocket().url).toBe('ws://127.0.0.1:7341/soloist');
    expect(result.current.isConnecting).toBe(true);
    joinSoloist(false);
    await waitFor(() => expect(result.current.browserDeviceId).toBe('soloist-1'));
    expect(result.current.isConnecting).toBe(false);
    expect(result.current.problem).toBeNull();
    expect(mocks.api.transferPlayback).not.toHaveBeenCalled();
  });

  it('warns when the kiosk player goes, and clears that once it is back', async () => {
    const { result, socket } = await ready();
    act(() => socket.receive({ type: 'bridge', connected: false }));
    expect(result.current.browserDeviceId).toBeNull();
    expect(result.current.error).toMatch(/tablet player disconnected/i);
    expect(result.current.problem?.recovery).toBe('reconnect');
    act(() => socket.receive({ type: 'bridge', connected: true }));
    await waitFor(() => expect(result.current.browserDeviceId).toBe('soloist-1'));
    expect(result.current.problem).toBeNull();
  });

  it('connects the player again on request, without taking over Spotify playback', async () => {
    const { result, socket } = await ready();
    act(() => socket.receive({ type: 'bridge', connected: false }));
    act(() => result.current.reconnectPlayer());
    expect(socket.isClosed).toBe(true);
    expect(fakeSocketCount()).toBe(2);
    expect(result.current.isConnecting).toBe(true);
    expect(result.current.problem).toBeNull();
    joinSoloist(false);
    await waitFor(() => expect(result.current.browserDeviceId).toBe('soloist-1'));
    expect(mocks.api.transferPlayback).not.toHaveBeenCalled();
    expect(mocks.api.play).not.toHaveBeenCalled();
  });

  it('reports a player that does not come up, and clears that once it does', async () => {
    mocks.api.getDevices.mockResolvedValue({ devices: [] });
    vi.useFakeTimers();
    const { result } = renderHook(() => useSpotifyPlayer());
    await advance(0);
    joinSoloist(false);
    await advance(19_999);
    expect(result.current.isConnecting).toBe(true);
    await advance(1);
    expect(result.current.isConnecting).toBe(false);
    expect(result.current.error).toBe('The kiosk player did not start. Try reconnecting.');
    expect(result.current.problem?.recovery).toBe('reconnect');
    mocks.api.getDevices.mockResolvedValue({ devices: [SOLOIST] });
    await advance(60_000);
    expect(result.current.browserDeviceId).toBe('soloist-1');
    expect(result.current.problem).toBeNull();
  });

  it('says nothing while Soloist restores its session, when it reports itself signed out for a moment', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSpotifyPlayer());
    await advance(0);
    const socket = joinSoloist(false);
    await advance(0);
    act(() => {
      socket.receive({ ...authState(false), logged_in: false });
    });
    await advance(1000);
    expect(result.current.problem).toBeNull();
    act(() => {
      socket.receive(authState(false));
    });
    await advance(10_000);
    expect(result.current.browserDeviceId).toBe('soloist-1');
    expect(result.current.problem).toBeNull();
  });

  it('asks for Soloist to be picked on a phone while it waits to be signed in, and clears that once it is', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSpotifyPlayer());
    await advance(0);
    const socket = joinSoloist(false);
    await advance(0);
    act(() => {
      socket.receive({ ...authState(false), logged_in: false });
    });
    await advance(30_000);
    expect(result.current.error).toBe('To sign the kiosk in, pick The Max Mix Soloist in Spotify on your phone.');
    expect(result.current.problem?.recovery).toBe('pick-on-phone');
    act(() => {
      socket.receive(authState(false));
    });
    await advance(0);
    expect(result.current.browserDeviceId).toBe('soloist-1');
    expect(result.current.problem).toBeNull();
  });

  it('sends the person to Settings when Soloist does not start because they saved no key', async () => {
    vi.spyOn(soloist, 'lastSoloistState').mockReturnValue('no-key');
    mocks.api.getDevices.mockResolvedValue({ devices: [] });
    vi.useFakeTimers();
    const { result } = renderHook(() => useSpotifyPlayer());
    await advance(0);
    await advance(20_000);
    expect(result.current.error).toBe('To play on the kiosk, add your Soloist key under Settings.');
    expect(result.current.problem?.recovery).toBe('soloist-key');
  });

  it('closes the connection on unmount', async () => {
    const { unmount, socket } = await ready();
    unmount();
    expect(socket.isClosed).toBe(true);
  });

  it('does not connect in remote playback mode or when signed out', async () => {
    mocks.settings.getPlaybackMode.mockReturnValue('remote');
    const remote = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(remote.result.current.isReady).toBe(true));
    expect(remote.result.current.isConnecting).toBe(false);
    remote.unmount();

    mocks.settings.getPlaybackMode.mockReturnValue('browser');
    mocks.auth.isSignedIn.mockReturnValue(false);
    renderHook(() => useSpotifyPlayer()).unmount();
    expect(fakeSocketCount()).toBe(0);
  });
});

describe('useSpotifyPlayer is driven by the kiosk player', () => {
  it('takes the song, the progress, shuffle and repeat from Soloist while it is the active device', async () => {
    // Spotify's own answer, which would replace these details, does not come.
    mocks.api.getPlaybackState.mockReturnValue(new Promise(() => {}));
    const { result } = await ready(true);
    expect(result.current.isPlayerActive).toBe(true);
    expect(result.current.playbackState).toMatchObject({
      is_playing: true,
      shuffle_state: false,
      repeat_state: 'off',
      duration: 205_049,
      item: { name: 'Henda mot himmelen', artists: [{ name: 'Madeléne' }] }
    });
  });

  it('shows a change at once and keeps it through a stale read', async () => {
    const { result, socket } = await ready(true);
    act(() => {
      socket.receive({ type: 'playback_changed', status: 'paused' });
      socket.receive({ type: 'position_sync', position: { position_ms: 4200, timestamp_ms: Date.now(), speed: 0 } });
    });
    expect(result.current.playbackState?.is_playing).toBe(false);
    expect(result.current.playbackState?.progress_ms).toBe(4200);
    // The Web API still says "playing" for a moment after; the button must not flip back.
    await act(async () => {
      await result.current.refreshPlayback();
    });
    expect(result.current.playbackState?.is_playing).toBe(false);
  });

  it('takes shuffle and repeat as Soloist reports them', async () => {
    const { result, socket } = await ready(true);
    act(() => socket.receive({ type: 'options_changed', options: { shuffle: true, repeat: 'track' } }));
    expect(result.current.playbackState).toMatchObject({ shuffle_state: true, repeat_state: 'track' });
    act(() => socket.receive({ type: 'options_changed', options: { shuffle: false, repeat: 'context' } }));
    expect(result.current.playbackState).toMatchObject({ shuffle_state: false, repeat_state: 'context' });
  });

  it('reads playback when the song changes, not on every event', async () => {
    const { socket } = await ready(true);
    await act(async () => {});
    const before = playbackCalls();
    act(() => {
      socket.receive({ type: 'position_sync', position: { position_ms: 9000, timestamp_ms: Date.now(), speed: 1 } });
    });
    await act(async () => {});
    expect(playbackCalls()).toBe(before);
    const [next] = recordedQueue()['upcoming'] as { item: unknown }[];
    act(() => socket.receive({ type: 'track_changed', item: next?.item }));
    await waitFor(() => expect(playbackCalls()).toBeGreaterThan(before));
  });

  it('reads the queue again when Soloist says it changed', async () => {
    const { result, socket } = await ready(true);
    const first = result.current.queueVersion;
    act(() => socket.receive(recordedQueue()));
    expect(result.current.queueVersion).toBe(first + 1);
  });

  it('reads playback only as a safety net while the kiosk player is active', async () => {
    await readyWithFakeTimers(true);
    await advance(100);
    const settled = playbackCalls();
    await advance(25_000);
    expect(playbackCalls()).toBe(settled);
    await advance(6000);
    expect(playbackCalls()).toBeGreaterThan(settled);
  });

  it('reads every 4 seconds again once another device takes over', async () => {
    const { result, socket } = await readyWithFakeTimers(true);
    act(() => socket.receive({ type: 'device_changed', is_active: false, device_name: RECORDED_DEVICE_NAME }));
    expect(result.current.isPlayerActive).toBe(false);
    await advance(100);
    const calls = playbackCalls();
    await advance(8000);
    expect(playbackCalls() - calls).toBeGreaterThanOrEqual(2);
  });
});

describe('useSpotifyPlayer drives the kiosk player', () => {
  it('plays and pauses through Soloist while it is the active device', async () => {
    const { result, socket } = await ready(true);
    await act(async () => {
      expect(await result.current.togglePlay()).toBe(true);
    });
    expect(commandsSent(socket)).toEqual(['pause']);
    expect(mocks.api.pause).not.toHaveBeenCalled();
  });

  it('sends next, previous, seek and volume to Soloist too', async () => {
    const { result, socket } = await ready(true);
    await act(async () => {
      await result.current.nextTrack();
      await result.current.previousTrack();
      await result.current.seek(1234.6);
      await result.current.setVolume(0.4);
    });
    expect(commandsSent(socket)).toEqual(['skip_next', 'skip_prev', 'seek', 'set_volume']);
    expect(socket.sent).toContainEqual({ type: 'command', command: 'seek', position_ms: 1235 });
    expect(socket.sent).toContainEqual({ type: 'command', command: 'set_volume', volume: 40 });
    expect(mocks.api.next).not.toHaveBeenCalled();
    expect(mocks.api.setVolume).not.toHaveBeenCalled();
  });

  it('keeps the kiosk player usable while Web API transfers are waiting', async () => {
    const { result, socket } = await ready(true);
    act(() => recordSpotifyRetryAfter(new SpotifyApiError('Rate limited', 429, 30)));
    await act(async () => {
      expect(await result.current.nextTrack()).toBe(true);
      expect(await result.current.togglePlay()).toBe(true);
      await expect(result.current.transferPlayback('another-device')).rejects.toMatchObject({ status: 429 });
    });
    expect(commandsSent(socket)).toHaveLength(2);
    expect(mocks.api.next).not.toHaveBeenCalled();
    expect(mocks.api.transferPlayback).not.toHaveBeenCalled();
  });

  it('sends Pause to the playing device through the Web API while another device plays', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(webState('phone'));
    const { result, socket } = await ready();
    await act(async () => {
      await result.current.togglePlay();
    });
    expect(mocks.api.pause).toHaveBeenCalledOnce();
    expect(commandsSent(socket)).toEqual([]);
  });

  it('starts a chosen playlist on the kiosk player', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(webState('phone'));
    const { result } = await ready();
    await act(async () => {
      expect(await result.current.playMusic(choice)).toBe(true);
    });
    expect(mocks.api.playChoice).toHaveBeenCalledWith(choice, 'soloist-1');
    expect(result.current.isPlayerActive).toBe(true);
    // Spotify still names the phone; the kiosk is shown while it catches up.
    expect(result.current.playbackState?.device).toMatchObject({ id: 'soloist-1', name: 'The Max Mix Soloist' });
  });

  it('looks the player up again and retries when Spotify no longer knows it', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(webState('phone'));
    const { result } = await ready();
    mocks.api.getDevices.mockResolvedValue({ devices: [{ ...SOLOIST, id: 'soloist-2' }] });
    mocks.api.playChoice.mockRejectedValueOnce(new SpotifyApiError('Device not found', 404));
    await act(async () => {
      expect(await result.current.playMusic(choice)).toBe(true);
    });
    expect(mocks.api.playChoice).toHaveBeenLastCalledWith(choice, 'soloist-2');
    expect(result.current.browserDeviceId).toBe('soloist-2');
    expect(result.current.problem).toBeNull();
  });

  it('moves playback to the player under its new id, after one more try, when Spotify no longer knows it', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(webState('phone'));
    const { result } = await ready();
    mocks.api.getDevices.mockResolvedValue({ devices: [{ ...SOLOIST, id: 'soloist-2' }] });
    mocks.api.transferPlayback
      .mockRejectedValueOnce(new SpotifyApiError('Device not found', 404))
      .mockRejectedValueOnce(new SpotifyApiError('Device not found', 404));
    await act(async () => {
      expect(await result.current.transferPlayback('soloist-1')).toBe(true);
    });
    expect(mocks.api.transferPlayback).toHaveBeenLastCalledWith('soloist-2', false);
    expect(mocks.api.transferPlayback).toHaveBeenCalledTimes(3);
  });

  it('gives up when Spotify does not list the player any more', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(webState('phone'));
    const { result } = await ready();
    mocks.api.getDevices.mockResolvedValue({ devices: [] });
    mocks.api.playChoice.mockRejectedValueOnce(new SpotifyApiError('Device not found', 404));
    await act(async () => {
      expect(await result.current.playMusic(choice)).toBe(false);
    });
    expect(result.current.problem?.recovery).toBe('choose-speaker');
  });

  describe('the device while playback settles onto the kiosk', () => {
    it('goes back to what Spotify says once it agrees, or says another device after all', async () => {
      mocks.api.getPlaybackState.mockResolvedValue(webState('phone'));
      const { result } = await ready();
      await act(async () => {
        await result.current.playMusic(choice);
      });
      mocks.api.getPlaybackState.mockResolvedValue(webState('soloist-1'));
      await act(async () => {
        await result.current.refreshPlayback();
      });
      expect(result.current.playbackState?.device).toMatchObject({ id: 'soloist-1', name: 'Somewhere' });
      // The hold ended with that agreement: a later read naming another device is believed.
      mocks.api.getPlaybackState.mockResolvedValue(webState('phone'));
      await act(async () => {
        await result.current.refreshPlayback();
      });
      expect(result.current.playbackState?.device?.id).toBe('phone');
      expect(result.current.isPlayerActive).toBe(false);
    });

    it('does not hold the device for a choice Spotify refused', async () => {
      mocks.api.getPlaybackState.mockResolvedValue(webState('phone'));
      const { result } = await ready();
      mocks.api.playChoice.mockRejectedValueOnce(new SpotifyApiError('Spotify request failed (500).', 500));
      await act(async () => {
        expect(await result.current.playMusic(choice)).toBe(false);
      });
      expect(result.current.playbackState?.device?.id).toBe('phone');
      expect(result.current.error).toBe('Spotify request failed (500).');
    });

    it('reads again after a moment to check', async () => {
      mocks.api.getPlaybackState.mockResolvedValue(webState('phone'));
      const { result } = await ready();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      await act(async () => {
        await result.current.playMusic(choice);
      });
      const afterPlay = playbackCalls();
      await advance(3000);
      expect(playbackCalls()).toBe(afterPlay + 1);
    });
  });

  it('starts a choice on the speaker picked under Speakers', async () => {
    const { result } = await ready(true);
    mocks.api.getPlaybackState.mockResolvedValue(webState('kitchen'));
    await act(async () => {
      await result.current.transferPlayback('kitchen');
    });
    const track = { uri: 'spotify:track:t', name: 'Song' };
    await act(async () => {
      expect(await result.current.playMusic(track)).toBe(true);
    });
    expect(mocks.api.playChoice).toHaveBeenCalledWith(track, 'kitchen');
  });

  it('makes the kiosk the player on Play, then sends it the next press once Soloist is active', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(webState('phone', false));
    const { result, socket } = await ready();
    await act(async () => {
      expect(await result.current.togglePlay()).toBe(true);
    });
    expect(mocks.api.transferPlayback).toHaveBeenCalledExactlyOnceWith('soloist-1', true);
    expect(result.current.isPlayerActive).toBe(true);
    expect(commandsSent(socket)).toEqual([]);

    act(() => socket.receive({ type: 'device_changed', is_active: true, device_name: RECORDED_DEVICE_NAME }));
    await act(async () => {
      await result.current.togglePlay();
    });
    expect(mocks.api.transferPlayback).toHaveBeenCalledOnce();
    expect(commandsSent(socket)).toHaveLength(1);
  });

  it('reports a failed first-Play transfer and puts the button back', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(webState('phone', false));
    mocks.api.transferPlayback.mockRejectedValue(new Error('No premium'));
    const { result } = await ready();
    await act(async () => {
      expect(await result.current.togglePlay()).toBe(false);
    });
    expect(result.current.error).toBe('No premium');
    expect(result.current.playbackState?.is_playing).toBe(false);
  });

  it('keeps using the Web API for a device picked under Speakers', async () => {
    const { result, socket } = await ready(true);
    await act(async () => {
      await result.current.transferPlayback('sonos-1');
    });
    expect(mocks.api.transferPlayback).toHaveBeenCalledWith('sonos-1', false);
    await act(async () => {
      await result.current.togglePlay();
      await result.current.nextTrack();
    });
    expect(commandsSent(socket)).toEqual([]);
    expect(mocks.api.pause).toHaveBeenCalledOnce();
    expect(mocks.api.next).toHaveBeenCalledOnce();
    // Picking the kiosk again hands control back to Soloist.
    await act(async () => {
      await result.current.transferPlayback('soloist-1');
    });
    await act(async () => {
      await result.current.togglePlay();
    });
    expect(commandsSent(socket)[0]).toBe('play');
    expect(mocks.api.play).not.toHaveBeenCalled();
  });

  it('reports a command Soloist refused, puts the button back and asks for the state again', async () => {
    const { result, socket } = await ready(true);
    await act(async () => {
      await result.current.refreshPlayback();
    });
    const asked = socket.sent.length;
    socket.reply = frame =>
      (frame as { command?: unknown }).command === 'pause' ? [{ type: 'error', message: 'Player not ready' }] : [];
    await act(async () => {
      expect(await result.current.togglePlay()).toBe(false);
    });
    expect(result.current.error).toBe('Player not ready');
    expect(result.current.playbackState?.is_playing).toBe(true);
    expect(socket.sent.slice(asked)).toEqual([
      { type: 'command', command: 'pause' },
      { type: 'command', command: 'get_state' }
    ]);
  });

  it('gives up on a command Soloist never answers, so the next press works', async () => {
    const { result, socket } = await ready(true);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { reply } = socket;
    socket.reply = () => [];
    let pressed: Promise<boolean> = Promise.resolve(true);
    act(() => {
      pressed = result.current.togglePlay();
    });
    await advance(8000);
    expect(await pressed).toBe(false);
    expect(result.current.error).toMatch(/did not answer/i);
    socket.reply = reply;
    await act(async () => {
      expect(await result.current.togglePlay()).toBe(true);
    });
  });
});

describe('useSpotifyPlayer keeps the Play button usable', () => {
  const playingWithRestrictions = {
    ...webState('soloist-1', true),
    actions: { disallows: { resuming: true, skipping_prev: true } }
  };

  it('drops the stale resuming restriction when Soloist pauses, and keeps the others', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(playingWithRestrictions);
    const { result, socket } = await ready(true);
    await waitFor(() => expect(result.current.playbackState?.actions?.disallows?.resuming).toBe(true));
    act(() => socket.receive({ type: 'playback_changed', status: 'paused' }));
    expect(result.current.playbackState?.is_playing).toBe(false);
    expect(result.current.playbackState?.actions?.disallows).toEqual({ skipping_prev: true });
  });

  it('shows what Soloist says even when Spotify reports nothing playing', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(null);
    const { result, socket } = await ready(true);
    act(() => socket.receive({ type: 'playback_changed', status: 'paused' }));
    expect(result.current.playbackState?.is_playing).toBe(false);
  });
});

describe('useSpotifyPlayer recovers after the page was in the background', () => {
  it('reads playback, the queue and the player state again when the tab comes back', async () => {
    const { result, socket } = await ready();
    await act(async () => {});
    const reads = playbackCalls();
    const queue = result.current.queueVersion;
    const asked = socket.sent.length;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(playbackCalls()).toBe(reads + 1));
    expect(result.current.queueVersion).toBe(queue + 1);
    expect(socket.sent.slice(asked)).toEqual([{ type: 'command', command: 'get_state' }]);
  });

  it('connects a dropped player again at once when the network is back', async () => {
    const { socket } = await ready();
    act(() => socket.end());
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(fakeSocketCount()).toBe(2);
  });

  it('does nothing while the page is hidden', async () => {
    const { socket } = await ready();
    const reads = playbackCalls();
    const asked = socket.sent.length;
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    visibility.mockRestore();
    await act(async () => {});
    expect(playbackCalls()).toBe(reads);
    expect(socket.sent).toHaveLength(asked);
  });
});

describe('useSpotifyPlayer polling in remote mode', () => {
  beforeEach(() => {
    mocks.settings.getPlaybackMode.mockReturnValue('remote');
  });

  it('reads playback every 4 seconds and never connects to Soloist', async () => {
    vi.useFakeTimers();
    renderHook(() => useSpotifyPlayer());
    await advance(0);
    expect(playbackCalls()).toBe(1);
    await advance(3999);
    expect(playbackCalls()).toBe(1);
    await advance(1);
    expect(playbackCalls()).toBe(2);
    await advance(8000);
    expect(playbackCalls()).toBe(4);
    expect(fakeSocketCount()).toBe(0);
  });

  it('backs off exponentially after failures and honours Retry-After', async () => {
    vi.useFakeTimers();
    mocks.api.getPlaybackState
      .mockRejectedValueOnce(new Error('blip'))
      .mockImplementationOnce(() => Promise.reject(new SpotifyApiError('Too many requests', 429, 45)))
      .mockResolvedValue(webState('d'));
    renderHook(() => useSpotifyPlayer());
    await advance(0);
    expect(playbackCalls()).toBe(1);
    // first failure: 8s delay (4s * 2^1)
    await advance(7999);
    expect(playbackCalls()).toBe(1);
    await advance(1);
    expect(playbackCalls()).toBe(2);
    // second failure: max(16s, retryAfter 45s)
    await advance(44_999);
    expect(playbackCalls()).toBe(2);
    await advance(1);
    expect(playbackCalls()).toBe(3);
  });

  it('clears the error once a poll succeeds', async () => {
    vi.useFakeTimers();
    mocks.api.getPlaybackState.mockRejectedValueOnce(new Error('blip')).mockResolvedValue(webState('d'));
    const { result } = renderHook(() => useSpotifyPlayer());
    await advance(0);
    expect(result.current.error).toBe('blip');
    await advance(8000);
    expect(result.current.error).toBeNull();
  });

  it('stops polling after unmount', async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useSpotifyPlayer());
    await advance(0);
    unmount();
    const calls = playbackCalls();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(playbackCalls()).toBe(calls);
  });
});
