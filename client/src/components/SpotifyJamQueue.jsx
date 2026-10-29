import { useState, useRef, useEffect } from 'react';
import { Users, Disc3, GripVertical, Play, ArrowUpRight, ListMusic, Headphones } from 'lucide-react';
import confetti from 'canvas-confetti';
import { getDivaForUser } from '../utils/divas.js';
import { trackKeys } from '../utils/trackKeys.js';

/** @type {import('../types.js').Track[]} */
const EMPTY_QUEUE = [];

/**
 * @param {{
 *   queue?: import('../types.js').Track[],
 *   onReorderQueue?: (queue: import('../types.js').Track[]) => unknown,
 *   onPlaySongNow?: (trackId: string | undefined, track: import('../types.js').Track) => unknown,
 *   onOpenJamSettings?: () => void,
 *   theme?: string,
 *   isDemoMode?: boolean,
 *   error?: string | null
 * }} props
 */
export default function SpotifyJamQueue({
  queue = EMPTY_QUEUE,
  onReorderQueue,
  onPlaySongNow,
  onOpenJamSettings,
  theme = 'neon',
  isDemoMode = false,
  error
}) {
  const [draggedIndex, setDraggedIndex] = useState(/** @type {number | null} */ (null));
  const [hoverIndex, setHoverIndex] = useState(/** @type {number | null} */ (null));
  const listRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const keys = trackKeys(queue);
  const queueRef = useRef(queue);
  const dragRef = useRef(/** @type {{ from: number, to: number } | null} */ (null));
  const cleanupDragRef = useRef(/** @type {(() => void) | null} */ (null));

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => () => cleanupDragRef.current?.(), []);

  /**
   * @param {number} from
   * @param {number} to
   */
  const moveTrack = async (from, to) => {
    if (from === to || to < 0 || to >= queueRef.current.length) return;
    const updated = [...queueRef.current];
    const [track] = updated.splice(from, 1);
    if (!track) return;
    updated.splice(to, 0, track);
    return await onReorderQueue?.(updated);
  };

  /**
   * @param {import('react').PointerEvent<HTMLElement>} e
   * @param {number} index
   */
  const handleHandlePointerDown = (e, index) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.currentTarget.focus();
    cleanupDragRef.current?.();
    dragRef.current = { from: index, to: index };
    setDraggedIndex(index);
    setHoverIndex(index);

    /** @param {PointerEvent} event */
    const handlePointerMove = event => {
      const children = Array.from(listRef.current?.children || []);
      const target = children.findIndex(child => {
        const rect = child.getBoundingClientRect();
        return event.clientY >= rect.top && event.clientY <= rect.bottom;
      });
      if (target !== -1) {
        /** @type {{ from: number, to: number }} */ (dragRef.current).to = target;
        setHoverIndex(target);
      }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      cleanupDragRef.current = null;
    };
    /** @param {boolean} commit */
    const finish = commit => {
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

  const totalMinutes = Math.round(queue.reduce((sum, track) => sum + (track.duration_ms || 0), 0) / 60000);

  return (
    <div className="queue-panel">
      <div className="queue-heading">
        <div>
          <span className="eyebrow">
            <ListMusic size={14} /> The shared soundtrack
          </span>
          <h2>
            Up next<span className="queue-count">{String(queue.length).padStart(2, '0')}</span>
          </h2>
        </div>
        <span className="session-pill">
          <Headphones size={13} /> {isDemoMode ? 'Demo queue' : 'Spotify queue'}
        </span>
      </div>

      <div className="jam-invitation">
        <div className="jam-icon">
          <Users size={20} />
        </div>
        <div className="jam-copy">
          <h3>Good music. Better company.</h3>
          <p>Start and manage a Jam in the Spotify app.</p>
        </div>
        <button
          type="button"
          onClick={onOpenJamSettings}
          className="jam-start"
          aria-label="How to start a Jam in Spotify"
        >
          <ArrowUpRight size={21} />
        </button>
      </div>

      {error && (
        <p role="alert" className="queue-error">
          {error}
        </p>
      )}
      <div className="queue-columns" aria-hidden="true">
        <span>#</span>
        <span>TRACK / ARTIST</span>
        <span>{isDemoMode ? 'DEMO GUEST' : 'IN SPOTIFY'}</span>
      </div>
      {queue.length === 0 ? (
        <div className="queue-empty">
          <div className="empty-record">
            <Disc3 size={32} strokeWidth={1} />
          </div>
          <h3>A little quiet in here.</h3>
          <p>
            Add a track in Spotify.
            <br />
            Your next great discovery goes here.
          </p>
        </div>
      ) : (
        <div ref={listRef} className="queue-list" role="list" aria-label="Track queue">
          {queue.map((track, idx) => {
            const title = track.name || track.title;
            const albumArt =
              track.album?.images?.[0]?.url ||
              track.albumArt ||
              'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=400&auto=format&fit=crop&q=80';
            const artist = track.artists ? track.artists.map(a => a.name).join(', ') : track.artist || 'Unknown artist';
            const rawAddedBy = track.added_by || track.addedBy || {};
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
                    onClick={() => {
                      void confetti({ particleCount: 18, spread: 45, origin: { x: 0.65, y: 0.4 } });
                      onPlaySongNow?.(track.id || track.uri, track);
                    }}
                  >
                    <span className="queue-number">{String(idx + 1).padStart(2, '0')}</span>
                    <Play className="queue-play-icon" size={14} fill="currentColor" />
                  </button>
                ) : (
                  <span className="queue-play queue-number">{String(idx + 1).padStart(2, '0')}</span>
                )}
                <img className="queue-art" src={albumArt} alt="" />
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
                    <img
                      src={rawAddedBy.avatar || assignedDiva.image}
                      alt=""
                      onError={e => {
                        e.currentTarget.src = assignedDiva.image;
                      }}
                    />
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
                              /** @type {HTMLElement | null | undefined} */ (
                                listRef.current?.children[target]?.querySelector('.queue-drag')
                              )?.focus();
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
          {totalMinutes > 0 ? ` / ${totalMinutes} min` : ''}
        </span>
      </div>
    </div>
  );
}
