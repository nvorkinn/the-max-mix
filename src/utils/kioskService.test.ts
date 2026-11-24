import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket, latestFakeSocket, resetFakeSockets } from '../test/fakeWebSocket';
import { checkImageUpdate, openUpdateStream, parseImageCheck, parseUpdateEvent } from './kioskService';

describe('parseUpdateEvent', () => {
  it('reads the frames the kiosk sends', () => {
    expect(parseUpdateEvent('{"type":"log","line":"a"}')).toEqual({ type: 'log', line: 'a' });
    expect(parseUpdateEvent('{"type":"error","line":"b"}')).toEqual({ type: 'error', line: 'b' });
    expect(parseUpdateEvent('{"type":"status","state":"installing"}')).toEqual({ type: 'status', state: 'installing' });
    expect(parseUpdateEvent('{"type":"status","state":"installed","message":"v2+abc"}')).toEqual({
      type: 'status',
      state: 'installed',
      message: 'v2+abc'
    });
    expect(parseUpdateEvent('{"type":"status","state":"done","message":"Nothing needed a restart."}')).toEqual({
      type: 'status',
      state: 'done',
      message: 'Nothing needed a restart.'
    });
  });

  it('ignores anything else', () => {
    for (const frame of [
      'not json',
      '5',
      'null',
      '{}',
      '{"type":"log"}',
      '{"type":"log","line":3}',
      '{"type":"status","state":"sleeping"}',
      '{"type":"other","line":"x"}',
      new ArrayBuffer(2)
    ]) {
      expect(parseUpdateEvent(frame)).toBeNull();
    }
  });
});

describe('openUpdateStream', () => {
  beforeEach(() => {
    resetFakeSockets();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });
  afterEach(() => vi.unstubAllGlobals());

  const handlers = () => ({ onOpen: vi.fn(), onEvent: vi.fn(), onClose: vi.fn() });

  it('connects to the update path of the kiosk service and reports what happens', () => {
    const h = handlers();
    openUpdateStream(h);
    const socket = latestFakeSocket();
    expect(socket.url).toBe('ws://127.0.0.1:7341/power/update');
    socket.open();
    socket.receive({ type: 'log', line: 'one' });
    socket.receive('garbage');
    socket.receive({ type: 'status', state: 'restarting' });
    socket.end();
    expect(h.onOpen).toHaveBeenCalledOnce();
    expect(h.onEvent.mock.calls).toEqual([[{ type: 'log', line: 'one' }], [{ type: 'status', state: 'restarting' }]]);
    expect(h.onClose).toHaveBeenCalledOnce();
  });

  it('closes the connection and goes quiet when asked to stop', () => {
    const h = handlers();
    const stop = openUpdateStream(h);
    const socket = latestFakeSocket();
    stop();
    expect(socket.isClosed).toBe(true);
    socket.open();
    socket.receive({ type: 'log', line: 'late' });
    socket.end();
    expect(h.onOpen).not.toHaveBeenCalled();
    expect(h.onEvent).not.toHaveBeenCalled();
    expect(h.onClose).not.toHaveBeenCalled();
  });
});

describe('checkImageUpdate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads what an image Pi’s channel has', async () => {
    const body = { channel: 'dev', current: 'dev+a', installed: '', busy: false, result: 'available', latest: 'dev+b' };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json(body)))
    );
    await expect(checkImageUpdate()).resolves.toEqual({
      current: 'dev+a',
      installed: null,
      result: 'available',
      latest: 'dev+b'
    });
  });

  it('is null when the service refuses or does not answer, and for anything else', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 404 })))
    );
    await expect(checkImageUpdate()).resolves.toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    );
    await expect(checkImageUpdate()).resolves.toBeNull();
    expect(parseImageCheck({ result: 'maybe' })).toBeNull();
    expect(parseImageCheck(null)).toBeNull();
  });
});
