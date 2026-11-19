import { Sun, Umbrella } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { WeatherBlockProps, WeatherPeriod } from '../../dashboard/props';
import { SKY_ICONS, sunny } from './icons';

const PERIOD_LABELS: Record<WeatherPeriod, string> = {
  now: 'Now',
  tonight: 'Tonight',
  tomorrow: 'Tomorrow',
  weekend: 'Weekend'
};

/** How long each period shows before the next. */
export const WEATHER_VIEW_MS = 10_000;
/** How long the old period takes to fade out, and then the new one to fade in. */
export const WEATHER_FADE_MS = 350;

/**
 * The periods as pills, the one on show filled; then the temperature with its sky's icon, what it's like and one line
 * more. It starts on Now and moves to the next period every ten seconds,
 * or at once on a tap; the periods wrap round. The old period fades right out before the new one fades in, so two
 * temperatures never show on top of each other.
 */
export default function WeatherBlock({ views }: Readonly<WeatherBlockProps>) {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const count = views.length;
  const view = views[index % Math.max(1, count)];

  // Each new period gets its full ten seconds, however it came (the timer or a tap).
  useEffect(() => {
    if (fading || count < 2) return;
    const timer = window.setTimeout(() => setFading(true), WEATHER_VIEW_MS);
    return () => window.clearTimeout(timer);
  }, [count, fading, index]);

  useEffect(() => {
    if (!fading) return;
    const timer = window.setTimeout(() => {
      setIndex(current => (current + 1) % Math.max(1, count));
      setFading(false);
    }, WEATHER_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [count, fading]);

  // With no forecast the block keeps its space, so the notices under it stay where they are.
  if (!view) {
    return (
      <div className="dashboard-weather" aria-hidden="true">
        <p className="dashboard-wx-pills">&nbsp;</p>
        <p className="dashboard-wx-temp">&nbsp;</p>
        <p className="dashboard-wx-condition">&nbsp;</p>
        <p className="dashboard-wx-summary" />
      </div>
    );
  }
  const SummaryIcon = view.summaryIcon === 'sun' ? Sun : Umbrella;
  const isDay = view.isDay ?? true;
  const SkyIcon = SKY_ICONS[view.sky][isDay ? 'day' : 'night'];
  const shown = index % count;
  return (
    <button
      type="button"
      className={`dashboard-weather shadowed${fading ? ' fading' : ''}`}
      onClick={() => {
        if (count > 1) setFading(true);
      }}
    >
      <span className="dashboard-wx-pills">
        {views.map((option, at) => (
          <span key={option.period} className="dashboard-wx-pill" aria-current={at === shown ? 'true' : undefined}>
            {PERIOD_LABELS[option.period]}
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
        <span className="dashboard-wx-summary">
          {view.summary && (
            <>
              <SummaryIcon className="lucide" style={{ width: 18, height: 18 }} aria-hidden="true" />
              {view.summary}
            </>
          )}
        </span>
      </span>
    </button>
  );
}
