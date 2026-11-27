import { useEffect, useState } from 'react';
import type { HourlyTrendProps, WeatherBlockProps, WeatherPeriod } from '../../dashboard/props';
import type { StringId } from '../../i18n/strings';
import { useT } from '../../i18n/translate';
import { TURN_MS } from './carousel';
import HourlyTrend from './HourlyTrend';
import { SKY_ICONS, sunny } from './icons';

const PERIOD_LABELS: Record<WeatherPeriod, StringId> = {
  now: 'weather.now',
  tomorrow: 'weather.tomorrow'
};

/** How long the old period takes to fade out, and then the new one to fade in. */
export const WEATHER_FADE_MS = 350;

interface WeatherBlockOwnProps extends WeatherBlockProps {
  /** The Dashboard's clock, in ms: the weather turns on the same TURN_MS beat as the boards and the rail's pages. */
  time: number;
  /** How each view's hourly trend is drawn, right under its temperature and words; no trend when null or left out. */
  trend?: HourlyTrendProps | null;
}

/**
 * The periods as pills, the one on show filled; then the temperature with its sky's icon and what it's like, and the
 * period's hourly trend. It starts on Now and moves to the next period on every turn of the Dashboard's carousels (carousel.ts), at the
 * same moment the boards and the rail's pages move, or at once on a tap; the periods wrap round. A period tapped to
 * moves on at the next shared turn, so the weather never drifts out of step. The old period fades right out before the
 * new one fades in, so two temperatures never show on top of each other.
 */
export default function WeatherBlock({ views, time, trend = null }: Readonly<WeatherBlockOwnProps>) {
  const t = useT();
  const count = views.length;
  const turn = Math.floor(time / TURN_MS);
  // Counted from the turn it first showed in, so it starts on Now.
  const [firstTurn] = useState(turn);
  const [taps, setTaps] = useState(0);
  const places = Math.max(1, count);
  const due = (((turn - firstTurn + taps) % places) + places) % places;
  const [index, setIndex] = useState(due);
  const fading = count > 1 && index !== due;
  const view = views[index % places];

  useEffect(() => {
    if (!fading) return;
    const timer = window.setTimeout(() => setIndex(due), WEATHER_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [due, fading]);

  // With no forecast the block keeps its space, so the notices under it stay where they are.
  if (!view) {
    return (
      <div className="dashboard-weather" aria-hidden="true">
        <p className="dashboard-wx-pills">&nbsp;</p>
        <p className="dashboard-wx-temp">&nbsp;</p>
        <p className="dashboard-wx-condition">&nbsp;</p>
      </div>
    );
  }
  const isDay = view.isDay ?? true;
  const SkyIcon = SKY_ICONS[view.sky][isDay ? 'day' : 'night'];
  const shown = index % count;
  return (
    <>
      <button
        type="button"
        className={`dashboard-weather shadowed${fading ? ' fading' : ''}`}
        onClick={() => {
          if (count > 1) setTaps(current => current + 1);
        }}
      >
        <span className="dashboard-wx-pills">
          {views.map((option, at) => (
            <span key={option.period} className="dashboard-wx-pill" aria-current={at === shown ? 'true' : undefined}>
              {t(PERIOD_LABELS[option.period])}
            </span>
          ))}
        </span>
        <span className="dashboard-wx-view">
          <span className="dashboard-wx-row">
            <span className="dashboard-wx-temp">
              {view.temperature}
              <span className="dashboard-wx-degree">°</span>
            </span>
            <SkyIcon
              className="lucide dashboard-wx-icon"
              aria-hidden="true"
              style={sunny(view.sky, isDay) ? { color: '#f6c453' } : undefined}
            />
          </span>
          <span className="dashboard-wx-condition">{view.condition}</span>
        </span>
      </button>
      {trend && (
        <div className={`dashboard-wx-trend${fading ? ' fading' : ''}`}>
          <HourlyTrend {...trend} hours={view.hours ?? []} />
        </div>
      )}
    </>
  );
}
