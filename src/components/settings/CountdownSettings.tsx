import { useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, Search, X } from 'lucide-react';
import type { TouchscreenConfig } from 'countdown-api';
import groupedOff from '../../assets/settings/group-by-route-off.gif';
import groupedOn from '../../assets/settings/group-by-route-on.gif';
import groupedOffStill from '../../assets/settings/group-by-route-off.png';
import groupedOnStill from '../../assets/settings/group-by-route-on.png';
import { describeStop, learnStopNames, rememberStop } from '../../countdown/search';
import type { DeviceConfig } from '../../hooks/useDeviceConfig';
import { useDragToReorder } from '../../hooks/useDragToReorder';
import { useT } from '../../i18n/translate';
import SettingsToggle from './SettingsToggle';
import StopSearch from './StopSearch';

/**
 * The stops whose departures the Countdown lists: a search box that opens the stop search over the whole screen
 * (StopSearch), then the saved stops in the Countdown's order, each with a handle to drag it to another place and an X
 * that removes it, and whether the Dashboard's boards group them by route, with a moving picture of the boards either way. Every change saves to countdown-server on its
 * own as soon as it is made.
 */
export default function CountdownSettings({
  config,
  onSave
}: Readonly<{ config: TouchscreenConfig; onSave: DeviceConfig['save'] }>) {
  const t = useT();
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
  const groupByRoute = config.arrivals.group_by_route ?? false;
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
        {t('countdown.add')}
      </button>

      <section className="settings-group countdown-column" aria-labelledby="saved-stops-label">
        <h5 className="settings-group-title" id="saved-stops-label">
          {t('countdown.saved')}
        </h5>
        <div className="countdown-column-body">
          {stops.length === 0 ? (
            <p className="text-muted py-2">{t('countdown.none')}</p>
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
                      aria-label={t('countdown.move', { name })}
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
                      aria-label={t('countdown.remove', { name })}
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

      <SettingsToggle
        id="group-by-route-label"
        title={t('countdown.group_by_route')}
        on={groupByRoute}
        onChange={value => onSave('arrivals', { ...config.arrivals, group_by_route: value })}
        className="countdown-grouping"
      >
        <div className="countdown-grouping-row">
          {/* Still under reduced motion: its last frame, how the board ends up. */}
          <picture className="countdown-grouping-picture">
            <source media="(prefers-reduced-motion: reduce)" srcSet={groupByRoute ? groupedOnStill : groupedOffStill} />
            <img
              src={groupByRoute ? groupedOn : groupedOff}
              alt={t(groupByRoute ? 'countdown.grouped_on' : 'countdown.grouped_off')}
              className="countdown-grouping-preview"
            />
          </picture>
        </div>
      </SettingsToggle>

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
