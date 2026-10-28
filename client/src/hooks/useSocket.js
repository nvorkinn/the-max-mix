import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export function useSocket() {
  const socketRef = useRef(null);
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

  const sendReaction = (emoji, guestName = 'Party Guest', color = '#ff4757') => {
    if (socketRef.current) {
      socketRef.current.emit('guest:reaction', { emoji, guestName, color });
    }
  };

  const requestTrack = (track, guest) => {
    if (socketRef.current) {
      socketRef.current.emit('guest:queue_request', { track, guest });
    }
  };

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
