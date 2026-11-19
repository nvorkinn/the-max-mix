import { useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, Search, X } from 'lucide-react';
import type { TouchscreenConfig } from 'countdown-api';
import { describeStop, learnStopNames, rememberStop } from '../../countdown/search';
import type { DeviceConfig } from '../../hooks/useDeviceConfig';
import { useDragToReorder } from '../../hooks/useDragToReorder';
import StopSearch from './StopSearch';

/**
 * The stops whose departures the Countdown lists: a search box that opens the stop search over the whole screen
 * (StopSearch), then the saved stops in the Countdown's order, each with a handle to drag it to another place and an X
 * that removes it. Every change saves to countdown-server on its own as soon as it is made.
 */
export default function CountdownSettings({
  config,
  onSave
}: Readonly<{ config: TouchscreenConfig; onSave: DeviceConfig['save'] }>) {
  const listRef = useRef<HTMLUListElement>(null);
  const [isSearching, setIsSearching] = useState(false);
  const stops = config.arrivals.stops;
  // A stop added on the settings site shows its id until its name comes from its departures on the server.
  const stopKeys = stops.map(stop => `${stop.source}:${stop.id}`).join(' ');
  const [namesLearnt, setNamesLearnt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void learnStopNames().then(learnt => {
      if (learnt && !cancelled) setNamesLearnt(count => count + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [stopKeys]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- namesLearnt: the names kept changed.
  const described = useMemo(() => stops.map(stop => describeStop(stop)), [stops, namesLearnt]);
  const saveStops = (next: typeof stops) => onSave('arrivals', { ...config.arrivals, stops: next });
  const removeStop = (stop: (typeof stops)[number]) =>
    saveStops(stops.filter(kept => kept.source !== stop.source || kept.id !== stop.id));
  const reorder = useDragToReorder(listRef, stops.length, (from, to) => {
    const next = [...stops];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    saveStops(next);
  });

  return (
    <div className="countdown-settings">
      <button type="button" onClick={() => setIsSearching(true)} className="countdown-search-button">
        <Search className="w-6 h-6 shrink-0" aria-hidden="true" />
        Add a station or stop
      </button>

      <section className="settings-group countdown-column" aria-labelledby="saved-stops-label">
        <h5 className="settings-group-title" id="saved-stops-label">
          Saved stops
        </h5>
        <div className="countdown-column-body">
          {stops.length === 0 ? (
            <p className="text-muted py-2">No stops yet.</p>
          ) : (
            <ul
              ref={listRef}
              className={`countdown-saved ${reorder.dragging ? 'is-reordering' : ''}`}
              aria-labelledby="saved-stops-label"
            >
              {stops.map((stop, index) => {
                const { name, detail } = described[index] ?? describeStop(stop);
                const { style, isDragged } = reorder.rowStyle(index);
                return (
                  <li
                    key={`${stop.source}:${stop.id}`}
                    className={`settings-box countdown-stop ${isDragged ? 'is-dragged' : ''}`}
                    style={style}
                  >
                    <button
                      type="button"
                      className="countdown-stop-handle"
                      aria-label={`Move ${name}`}
                      aria-keyshortcuts="ArrowUp ArrowDown"
                      disabled={stops.length < 2}
                      {...reorder.handleProps(index)}
                    >
                      <GripVertical className="w-5 h-5" aria-hidden="true" />
                    </button>
                    <span className="min-w-0 flex-1">
                      <span className="settings-box-title block truncate">{name}</span>
                      {detail && <span className="block text-muted truncate">{detail}</span>}
                    </span>
                    <button
                      type="button"
                      className="countdown-stop-remove"
                      aria-label={`Remove ${name}`}
                      onClick={() => removeStop(stop)}
                    >
                      <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {isSearching && (
        <StopSearch
          stops={stops}
          onClose={() => setIsSearching(false)}
          onAdd={result => {
            rememberStop(result);
            saveStops([...stops, result.value]);
          }}
          onRemove={result => removeStop(result.value)}
        />
      )}
    </div>
  );
}
