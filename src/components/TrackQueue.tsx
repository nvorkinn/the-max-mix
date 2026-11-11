import { useRef } from 'react';
import { Disc3, GripVertical } from 'lucide-react';
import { useDragToReorder } from '../hooks/useDragToReorder';
import { trackKeys } from '../utils/trackKeys';
import type { Track } from '../types';
import { Artwork } from './TrackImages';

const EMPTY_QUEUE: Track[] = [];
export type QueueStatus = 'idle' | 'loading' | 'ready' | 'error' | 'waiting';

interface TrackQueueProps {
  queue?: Track[];
  error?: string | null;
  status?: QueueStatus;
  onRetry?: () => void;
  onConnect?: () => void;
  retryAllowed?: boolean;
  /** Plays the song at this position in the queue. Without it the rows are not tappable. */
  onPlay?: (index: number) => unknown;
  /** True while playing a song is not possible (controls unavailable, or a jump is under way). */
  playDisabled?: boolean;
  /**
   * Moves the song at place `from` to place `to`. With it each row gets a handle to drag it by (only where the queue can
   * be reordered: a Sonos's can, Spotify's cannot); while playDisabled the handles are off too.
   */
  onMove?: ((from: number, to: number) => unknown) | undefined;
}

export default function TrackQueue({
  queue = EMPTY_QUEUE,
  error,
  status = 'ready',
  onRetry,
  onConnect,
  retryAllowed = true,
  onPlay,
  playDisabled = false,
  onMove
}: Readonly<TrackQueueProps>) {
  const keys = trackKeys(queue);
  const listRef = useRef<HTMLDivElement>(null);
  const canMove = Boolean(onMove) && !playDisabled && queue.length > 1;
  const reorder = useDragToReorder(listRef, queue.length, canMove ? onMove : undefined);

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
      case 'waiting': {
        return (
          <div className="queue-empty" role="status">
            <p>Waiting for Spotify...</p>
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
      {error && (
        <p role="alert" className="queue-error">
          {error}
        </p>
      )}
      {status === 'waiting' && queue.length > 0 && (
        <p className="queue-status" role="status">
          Waiting for Spotify before updating the queue.
        </p>
      )}
      {(error || status === 'waiting') && queue.length > 0 && (
        <p className="queue-status">Showing the last known queue.</p>
      )}
      {(status === 'error' || error) && onRetry && (
        <button
          type="button"
          className="button button-secondary queue-retry"
          disabled={status === 'loading' || status === 'waiting' || !retryAllowed}
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      )}
      {queue.length === 0 ? (
        emptyState()
      ) : (
        <>
          <p className="queue-heading">Up next:</p>
          <div
            ref={listRef}
            className={`queue-list ${reorder.dragging ? 'is-reordering' : ''}`}
            role="list"
            aria-label="Track queue"
          >
            {queue.map((track, idx) => {
              const title = track.name || track.title;
              const albumArt = track.album?.images?.[0]?.url || track.albumArt;
              const artist = track.artists
                ? track.artists.map(a => a.name).join(', ')
                : track.artist || 'Unknown artist';

              const { style, isDragged } = reorder.rowStyle(idx);
              return (
                <div
                  key={keys[idx]}
                  role="listitem"
                  className={`queue-track ${idx === 0 ? 'is-next' : ''} ${isDragged ? 'is-dragged' : ''}`}
                  style={style}
                >
                  <button
                    type="button"
                    className="queue-track-button"
                    disabled={!onPlay || playDisabled}
                    onClick={() => void onPlay?.(idx)}
                    aria-label={`Play ${title} by ${artist}`}
                  >
                    <span className="queue-play queue-number">{String(idx + 1).padStart(2, '0')}</span>
                    <Artwork className="queue-art" src={albumArt} alt="" />
                    <div className="queue-track-copy">
                      <div className="queue-title">
                        <h3 title={title}>{title}</h3>
                        {idx === 0 && <span className="next-label">NEXT</span>}
                      </div>
                      <p title={artist}>{artist}</p>
                    </div>
                  </button>
                  {onMove && (
                    <button
                      type="button"
                      className="queue-move"
                      disabled={!canMove}
                      aria-label={`Move ${title}`}
                      aria-keyshortcuts="ArrowUp ArrowDown"
                      {...reorder.handleProps(idx)}
                    >
                      <GripVertical size={20} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
