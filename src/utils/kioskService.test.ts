import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket, latestFakeSocket, resetFakeSockets } from '../test/fakeWebSocket';
import { openUpdateStream, parseUpdateEvent } from './kioskService';

describe('parseUpdateEvent', () => {
  it('reads the frames the kiosk sends', () => {
    expect(parseUpdateEvent('{"type":"log","line":"a"}')).toEqual({ type: 'log', line: 'a' });
    expect(parseUpdateEvent('{"type":"error","line":"b"}')).toEqual({ type: 'error', line: 'b' });
    expect(parseUpdateEvent('{"type":"status","state":"pulling"}')).toEqual({ type: 'status', state: 'pulling' });
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
