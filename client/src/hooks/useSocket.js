import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export function useSocket() {
  const socketRef = useRef(/** @type {import('socket.io-client').Socket | null} */ (null));
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Connect to current origin in prod or dev proxy
    const socket = io('/', {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('⚡ Socket connected to Party Server');
      setConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      setConnected(false);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  /**
   * @param {string} emoji
   * @param {string} [guestName]
   * @param {string} [color]
   */
  const sendReaction = (emoji, guestName = 'Party Guest', color = '#ff4757') => {
    if (socketRef.current) {
      socketRef.current.emit('guest:reaction', { emoji, guestName, color });
    }
  };

  /**
   * @param {import('../types.js').Track} track
   * @param {unknown} guest
   */
  const requestTrack = (track, guest) => {
    if (socketRef.current) {
      socketRef.current.emit('guest:queue_request', { track, guest });
    }
  };

  /**
   * @param {string} trackId
   * @param {string} guestId
   */
  const upvoteTrack = (trackId, guestId) => {
    if (socketRef.current) {
      socketRef.current.emit('guest:upvote', { trackId, guestId });
    }
  };

  return {
    socket: socketRef.current,
    connected,
    sendReaction,
    requestTrack,
    upvoteTrack
  };
}
