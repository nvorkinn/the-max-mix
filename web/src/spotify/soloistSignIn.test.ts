import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket, fakeSocketCount, latestFakeSocket, resetFakeSockets } from '../test/fakeWebSocket';
import { authState, recordedNow, RECORDED_DEVICE_NAME } from '../test/soloistFixtures';
import { RECONNECT_MS } from './soloistPlayer';
import { watchSoloistAuth } from './soloistSignIn';
import type { SoloistAuth } from './soloistSignIn';

const SIGNED_OUT = { type: 'auth_state', logged_in: false, is_active: false, device_name: 'The Max Mix 4' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  resetFakeSockets();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('watchSoloistAuth', () => {
  it('asks Soloist where its sign-in stands once the service says it is there, and passes on every answer', () => {
    const onAuth = vi.fn<(auth: SoloistAuth) => void>();
    watchSoloistAuth(onAuth);
    const socket = latestFakeSocket();
    expect(socket.url).toBe('ws://127.0.0.1:7341/soloist');
    socket.open();
    // Soloist only starts once the person's key is there.
    socket.receive({ type: 'bridge', connected: false });
    expect(socket.sent).toEqual([]);

    socket.reply = () => [SIGNED_OUT];
    socket.receive({ type: 'bridge', connected: true });
    expect(socket.sent).toEqual([{ type: 'command', command: 'get_auth_state' }]);
    expect(onAuth).toHaveBeenLastCalledWith({ isSignedIn: false, deviceName: 'The Max Mix 4' });

    // They picked the kiosk in Spotify on their phone.
    socket.receive(authState(true));
    expect(onAuth).toHaveBeenLastCalledWith({ isSignedIn: true, deviceName: RECORDED_DEVICE_NAME });
    expect(onAuth).toHaveBeenCalledTimes(2);
  });

  it('takes a sign-in that names no device, and passes over everything else Soloist sends', () => {
    const onAuth = vi.fn<(auth: SoloistAuth) => void>();
    watchSoloistAuth(onAuth);
    const socket = latestFakeSocket();
    socket.receive('not JSON');
    socket.receive('"a string"');
    socket.receive(recordedNow(true));
    expect(onAuth).not.toHaveBeenCalled();
    socket.receive({ type: 'auth_state', logged_in: true });
    expect(onAuth).toHaveBeenCalledExactlyOnceWith({ isSignedIn: true, deviceName: null });
  });

  it('connects again when the connection drops, until it is stopped', () => {
    const onAuth = vi.fn<(auth: SoloistAuth) => void>();
    const stop = watchSoloistAuth(onAuth);
    const first = latestFakeSocket();
    first.end();
    vi.advanceTimersByTime(RECONNECT_MS);
    expect(fakeSocketCount()).toBe(2);

    const second = latestFakeSocket();
    stop();
    expect(second.isClosed).toBe(true);
    // Nothing is passed on, and nothing connects, after that.
    second.receive(authState(true));
    vi.advanceTimersByTime(RECONNECT_MS);
    expect(onAuth).not.toHaveBeenCalled();
    expect(fakeSocketCount()).toBe(2);
  });

  it('does not connect again when stopped while it waits to', () => {
    const stop = watchSoloistAuth(vi.fn());
    latestFakeSocket().end();
    stop();
    vi.advanceTimersByTime(RECONNECT_MS);
    expect(fakeSocketCount()).toBe(1);
  });
});
