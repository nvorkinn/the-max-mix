import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const socket = vi.hoisted(() => ({
  handlers: {},
  on: vi.fn(function on(event, fn) {
    this.handlers[event] = fn;
  }),
  emit: vi.fn(),
  disconnect: vi.fn()
}));
const io = vi.hoisted(() => vi.fn());

vi.mock('socket.io-client', () => ({ io }));

import { useSocket } from './useSocket.js';

describe('useSocket', () => {
  beforeEach(() => {
    socket.handlers = {};
    io.mockReturnValue(socket);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('connects to the current origin and tracks connection state', () => {
    const { result } = renderHook(() => useSocket());
    expect(io).toHaveBeenCalledWith('/', expect.objectContaining({ reconnectionAttempts: 10 }));
    expect(result.current.connected).toBe(false);

    act(() => socket.handlers.connect());
    expect(result.current.connected).toBe(true);

    act(() => socket.handlers.disconnect());
    expect(result.current.connected).toBe(false);
  });

  it('emits reactions, requests and upvotes', () => {
    const { result } = renderHook(() => useSocket());
    result.current.sendReaction('x');
    expect(socket.emit).toHaveBeenCalledWith('guest:reaction', {
      emoji: 'x',
      guestName: 'Party Guest',
      color: '#ff4757'
    });
    result.current.requestTrack({ id: 't' }, { name: 'g' });
    expect(socket.emit).toHaveBeenCalledWith('guest:queue_request', { track: { id: 't' }, guest: { name: 'g' } });
    result.current.upvoteTrack('t', 'g1');
    expect(socket.emit).toHaveBeenCalledWith('guest:upvote', { trackId: 't', guestId: 'g1' });
  });

  it('disconnects on unmount', () => {
    const { unmount } = renderHook(() => useSocket());
    unmount();
    expect(socket.disconnect).toHaveBeenCalled();
  });
});
