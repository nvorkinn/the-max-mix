import { useRef, useState } from 'react';
import { GripVertical, Plus, Search, X } from 'lucide-react';
import type { TouchscreenConfig } from 'countdown-api';
import { describeStop, rememberStop, searchStops } from '../../countdown/search';
import type { DeviceConfig } from '../../hooks/useDeviceConfig';
import { useDragToReorder } from '../../hooks/useDragToReorder';
import { useOnScreenKeyboard } from '../../hooks/useOnScreenKeyboard';
import SearchResults from './SearchResults';

/**
 * The stops whose departures the Countdown lists, as two lists side by side: on the left a search for stops, where a tap
 * on one adds it; on the right the saved stops, in the Countdown's order, each with a handle to drag it to another place
 * and an X that removes it. Every change saves to countdown-server on its own as soon as it is made.
 */
export default function CountdownSettings({
  config,
  onSave
}: Readonly<{ config: TouchscreenConfig; onSave: DeviceConfig['save'] }>) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const stops = config.arrivals.stops;
  const saveStops = (next: typeof stops) => onSave('arrivals', { ...config.arrivals, stops: next });
  const reorder = useDragToReorder(listRef, stops.length, (from, to) => {
    const next = [...stops];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    saveStops(next);
  });
  // Not focused at once: the keyboard would cover the saved stops before anyone asked to search.
  useOnScreenKeyboard(fieldRef, { focus: false, hasNumberRow: true });

  return (
    <div className="countdown-settings">
      <section className="settings-group countdown-column" aria-labelledby="stop-search-label">
        <h5 className="settings-group-title" id="stop-search-label">
          Find stops
        </h5>
        <div className="countdown-search">
          <Search className="countdown-search-icon" aria-hidden="true" />
          <input
            ref={fieldRef}
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            aria-label="Search for a stop"
            placeholder="Station or stop"
            autoComplete="off"
            spellCheck={false}
            className="music-search w-full min-h-12 pl-11 pr-4 rounded-xl border text-sm"
          />
        </div>
        <div className="countdown-column-body">
          {query.trim() === '' ? (
            <p className="text-muted py-2">Type a station or stop, then tap it to add it to the saved stops.</p>
          ) : (
            <SearchResults
              query={query.trim()}
              search={searchStops}
              exclude={stops.map(stop => `${stop.source}:${stop.id}`)}
              icon={<Plus className="w-5 h-5 shrink-0 text-accent" aria-hidden="true" />}
              onPick={result => {
                rememberStop(result);
                saveStops([...stops, result.value]);
              }}
            />
          )}
        </div>
      </section>

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
                const { name, detail } = describeStop(stop);
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
                      onClick={() =>
                        saveStops(stops.filter(kept => kept.source !== stop.source || kept.id !== stop.id))
                      }
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
    </div>
  );
}
