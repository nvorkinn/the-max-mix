import { Sun, Umbrella } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { WeatherBlockProps, WeatherPeriod } from '../../dashboard/props';

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
 * The temperature, what it's like and one line more. It starts on Now and moves to the next period every ten seconds,
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
        <p className="dashboard-wx-period">&nbsp;</p>
        <p className="dashboard-wx-temp">&nbsp;</p>
        <p className="dashboard-wx-condition">&nbsp;</p>
        <p className="dashboard-wx-summary" />
      </div>
    );
  }
  const SummaryIcon = view.summaryIcon === 'sun' ? Sun : Umbrella;
  return (
    <button
      type="button"
      className={`dashboard-weather shadowed${fading ? ' fading' : ''}`}
      onClick={() => {
        if (count > 1) setFading(true);
      }}
    >
      <p className="dashboard-wx-period">{PERIOD_LABELS[view.period]}</p>
      <p className="dashboard-wx-temp">
        {view.temperature}
        <span className="dashboard-wx-degree">°</span>
      </p>
      <p className="dashboard-wx-condition">{view.condition}</p>
      <p className="dashboard-wx-summary">
        {view.summary && (
          <>
            <SummaryIcon className="lucide" style={{ width: 18, height: 18 }} aria-hidden="true" />
            {view.summary}
          </>
        )}
      </p>
    </button>
  );
}
