import { Disc3 } from 'lucide-react';
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
}

export default function TrackQueue({
  queue = EMPTY_QUEUE,
  error,
  status = 'ready',
  onRetry,
  onConnect,
  retryAllowed = true,
  onPlay,
  playDisabled = false
}: Readonly<TrackQueueProps>) {
  const keys = trackKeys(queue);

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
        <div className="queue-list" role="list" aria-label="Track queue">
          {queue.map((track, idx) => {
            const title = track.name || track.title;
            const albumArt = track.album?.images?.[0]?.url || track.albumArt;
            const artist = track.artists ? track.artists.map(a => a.name).join(', ') : track.artist || 'Unknown artist';

            return (
              <div key={keys[idx]} role="listitem" className={`queue-track ${idx === 0 ? 'is-next' : ''}`}>
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
