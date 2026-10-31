import { useState, useRef, useEffect } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Disc3, GripVertical, Play, ArrowUpRight } from 'lucide-react';
import { getDivaForUser } from '../utils/divas';
import { trackKeys } from '../utils/trackKeys';
import type { Track } from '../types';
import { Artwork, GuestAvatar } from './TrackImages';

const EMPTY_QUEUE: Track[] = [];
export type QueueStatus = 'idle' | 'loading' | 'ready' | 'error';

interface TrackQueueProps {
  queue?: Track[];
  onReorderQueue?: (queue: Track[]) => unknown;
  onPlaySongNow?: (trackId: string | undefined, track: Track) => unknown;
  theme?: string;
  isDemoMode?: boolean;
  error?: string | null;
  status?: QueueStatus;
  onRetry?: () => void;
  onConnect?: () => void;
  retryAllowed?: boolean;
}

export default function TrackQueue({
  queue = EMPTY_QUEUE,
  onReorderQueue,
  onPlaySongNow,
  theme = 'neon',
  isDemoMode = false,
  error,
  status = 'ready',
  onRetry,
  onConnect,
  retryAllowed = true
}: Readonly<TrackQueueProps>) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const keys = trackKeys(queue);
  const queueRef = useRef(queue);
  const dragRef = useRef<{ from: number; to: number } | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => () => cleanupDragRef.current?.(), []);

  const moveTrack = async (from: number, to: number) => {
    if (from === to || to < 0 || to >= queueRef.current.length) return;
    const updated = [...queueRef.current];
    const [track] = updated.splice(from, 1);
    if (!track) return;
    updated.splice(to, 0, track);
    return await onReorderQueue?.(updated);
  };

  const handleHandlePointerDown = (e: ReactPointerEvent<HTMLElement>, index: number) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.currentTarget.focus();
    cleanupDragRef.current?.();
    dragRef.current = { from: index, to: index };
    setDraggedIndex(index);
    setHoverIndex(index);

    const handlePointerMove = (event: PointerEvent) => {
      const children = [...(listRef.current?.children ?? [])];
      const target = children.findIndex(child => {
        const rect = child.getBoundingClientRect();
        return event.clientY >= rect.top && event.clientY <= rect.bottom;
      });
      if (target !== -1) {
        if (dragRef.current) dragRef.current.to = target;
        setHoverIndex(target);
      }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      cleanupDragRef.current = null;
    };
    const finish = (commit: boolean) => {
      const drag = dragRef.current;
      cleanup();
      dragRef.current = null;
      setDraggedIndex(null);
      setHoverIndex(null);
      if (commit && drag) void moveTrack(drag.from, drag.to);
    };
    const handlePointerUp = () => finish(true);
    const handlePointerCancel = () => finish(false);
    cleanupDragRef.current = cleanup;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
  };

  const totalMinutes = Math.round(queue.reduce((sum, track) => sum + (track.duration_ms || 0), 0) / 60_000);
  const showCount = queue.length > 0 || (status === 'ready' && !error);
  let retryLabel = 'Waiting to retry...';
  if (status === 'loading') retryLabel = 'Retrying...';
  else if (retryAllowed) retryLabel = 'Retry queue';
  const emptyState = () => {
    switch (status) {
      case 'loading': {
        return (
          <div className="queue-empty" role="status">
            <p>Loading queue...</p>
          </div>
        );
      }
      case 'idle': {
        return (
          <div className="queue-empty">
            <h3>Connect Spotify to see the queue.</h3>
            {onConnect && (
              <button type="button" className="button button-secondary" onClick={onConnect}>
                Connect Spotify
              </button>
            )}
          </div>
        );
      }
      default:
    }
    if (status === 'error' || error) {
      return (
        <div className="queue-empty">
          <h3>Queue unavailable.</h3>
          <p>The queue could not be loaded.</p>
        </div>
      );
    }
    return (
      <div className="queue-empty">
        <div className="empty-record">
          <Disc3 size={32} strokeWidth={1} />
        </div>
        <h3>A little quiet in here.</h3>
        <p>Add a track in Spotify.</p>
      </div>
    );
  };

  return (
    <div className="queue-panel">
      <div className="queue-heading">
        <h2>Up next{showCount && <span className="queue-count">{String(queue.length).padStart(2, '0')}</span>}</h2>
      </div>

      {error && (
        <p role="alert" className="queue-error">
          {error}
        </p>
      )}
      {status === 'loading' && queue.length > 0 && (
        <p className="queue-status" role="status">
          Updating queue...
        </p>
      )}
      {error && queue.length > 0 && <p className="queue-status">Showing the last known queue.</p>}
      {(status === 'error' || error) && onRetry && (
        <button
          type="button"
          className="button button-secondary queue-retry"
          disabled={status === 'loading' || !retryAllowed}
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      )}
      <div className="queue-columns" aria-hidden="true">
        <span>#</span>
        <span>TRACK / ARTIST</span>
        <span>{isDemoMode ? 'DEMO GUEST' : 'IN SPOTIFY'}</span>
      </div>
      {queue.length === 0 ? (
        emptyState()
      ) : (
        <div ref={listRef} className="queue-list" role="list" aria-label="Track queue">
          {queue.map((track, idx) => {
            const title = track.name || track.title;
            const albumArt = track.album?.images?.[0]?.url || track.albumArt;
            const artist = track.artists ? track.artists.map(a => a.name).join(', ') : track.artist || 'Unknown artist';
            const rawAddedBy = track.added_by ?? track.addedBy ?? {};
            const guestName = isDemoMode ? rawAddedBy.name : null;
            const assignedDiva = getDivaForUser(guestName || '', idx, theme);
            const seconds = Math.floor((track.duration_ms || 0) / 1000);

            return (
              <div
                key={keys[idx]}
                role="listitem"
                className={`queue-track ${idx === 0 ? 'is-next' : ''} ${draggedIndex === idx ? 'is-dragging' : ''} ${hoverIndex === idx && draggedIndex !== null && draggedIndex !== idx ? 'is-drop-target' : ''}`}
              >
                {isDemoMode ? (
                  <button
                    type="button"
                    className="queue-play"
                    aria-label={`Play ${title} now`}
                    onClick={() => onPlaySongNow?.(track.id || track.uri, track)}
                  >
                    <span className="queue-number">{String(idx + 1).padStart(2, '0')}</span>
                    <Play className="queue-play-icon" size={14} fill="currentColor" />
                  </button>
                ) : (
                  <span className="queue-play queue-number">{String(idx + 1).padStart(2, '0')}</span>
                )}
                <Artwork className="queue-art" src={albumArt} alt="" />
                <div className="queue-track-copy">
                  <div className="queue-title">
                    <h3 title={title}>{title}</h3>
                    {idx === 0 && <span className="next-label">NEXT</span>}
                  </div>
                  <p title={artist}>{artist}</p>
                </div>
                <span className="queue-duration">
                  {seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '--:--'}
                </span>
                {guestName && (
                  <div className="queue-guest" aria-label={`Demo guest ${guestName}`} title={`Demo guest ${guestName}`}>
                    <GuestAvatar src={rawAddedBy.avatar || assignedDiva.image} name={guestName} />
                    <span>{guestName}</span>
                  </div>
                )}
                {isDemoMode ? (
                  <button
                    type="button"
                    className="queue-drag"
                    aria-label={`Reorder ${title}`}
                    aria-describedby="queue-reorder-help"
                    onPointerDown={e => handleHandlePointerDown(e, idx)}
                    onKeyDown={e => {
                      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                        e.preventDefault();
                        const target = idx + (e.key === 'ArrowUp' ? -1 : 1);
                        void moveTrack(idx, target).then(success => {
                          if (success) {
                            requestAnimationFrame(() => {
                              listRef.current?.children[target]?.querySelector<HTMLElement>('.queue-drag')?.focus();
                            });
                          }
                        });
                      }
                    }}
                  >
                    <GripVertical size={17} />
                  </button>
                ) : (
                  <a
                    className="queue-link"
                    href={track.external_urls?.spotify || 'https://open.spotify.com'}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${title} in Spotify`}
                  >
                    <ArrowUpRight size={16} />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCount && (
        <div className="queue-footer">
          <span id="queue-reorder-help">
            {isDemoMode ? (
              <>
                Reorder demo tracks<span className="sr-only"> with a drag handle or its up and down arrow keys.</span>
              </>
            ) : (
              'Reorder and manage tracks in Spotify'
            )}
          </span>
          <span>
            {queue.length} {queue.length === 1 ? 'track' : 'tracks'}
            {status !== 'ready' || error ? ' last known' : ''}
            {totalMinutes > 0 ? ` / ${totalMinutes} min` : ''}
          </span>
        </div>
      )}
    </div>
  );
}
