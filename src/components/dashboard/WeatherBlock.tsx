import { Sun, Umbrella } from 'lucide-react';
import { useState } from 'react';
import type { WeatherBlockProps, WeatherPeriod } from '../../dashboard/props';

const PERIOD_LABELS: Record<WeatherPeriod, string> = {
  now: 'Now',
  tonight: 'Tonight',
  tomorrow: 'Tomorrow',
  weekend: 'Weekend'
};

/** The temperature, what it's like and one line more. A tap moves to the next period; the periods wrap round. */
export default function WeatherBlock({ views }: Readonly<WeatherBlockProps>) {
  const [index, setIndex] = useState(0);
  const view = views[index % Math.max(1, views.length)];
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
      className="dashboard-weather shadowed"
      onClick={() => setIndex(current => (current + 1) % views.length)}
    >
      <p className="dashboard-wx-period">{PERIOD_LABELS[view.period]}</p>
      <p className="dashboard-wx-temp">{view.temperature}°</p>
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
