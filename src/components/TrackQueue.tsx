import { Disc3, ArrowUpRight } from 'lucide-react';
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
}

export default function TrackQueue({
  queue = EMPTY_QUEUE,
  error,
  status = 'ready',
  onRetry,
  onConnect,
  retryAllowed = true
}: Readonly<TrackQueueProps>) {
  const keys = trackKeys(queue);

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
      <div className="queue-columns" aria-hidden="true">
        <span>#</span>
        <span>TRACK / ARTIST</span>
        <span>IN SPOTIFY</span>
      </div>
      {queue.length === 0 ? (
        emptyState()
      ) : (
        <div className="queue-list" role="list" aria-label="Track queue">
          {queue.map((track, idx) => {
            const title = track.name || track.title;
            const albumArt = track.album?.images?.[0]?.url || track.albumArt;
            const artist = track.artists ? track.artists.map(a => a.name).join(', ') : track.artist || 'Unknown artist';
            const seconds = Math.floor((track.duration_ms || 0) / 1000);

            return (
              <div key={keys[idx]} role="listitem" className={`queue-track ${idx === 0 ? 'is-next' : ''}`}>
                <span className="queue-play queue-number">{String(idx + 1).padStart(2, '0')}</span>
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
                <a
                  className="queue-link"
                  href={track.external_urls?.spotify || 'https://open.spotify.com'}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${title} in Spotify`}
                >
                  <ArrowUpRight size={16} />
                </a>
              </div>
            );
          })}
        </div>
      )}

      {showCount && (
        <div className="queue-footer">
          <span>Reorder and manage tracks in Spotify</span>
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
