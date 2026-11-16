import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { TouchscreenConfig } from 'countdown-api';
import { Bus, Cloud, CloudRain, CloudSnow, CloudSun, Sun } from 'lucide-react';
import { ARRIVALS_MAX_AGE_MS, getDashboardData, isFresh, WEATHER_MAX_AGE_MS } from '../dashboard/data';
import type { Arrival, Arrivals, Conditions, DashboardData, Weather } from '../dashboard/data';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';
import { DEFAULT_CLOCK_FORMAT, formatClockTime } from '../utils/clockFormat';
import type { ClockFormat } from '../utils/clockFormat';

/** How often the Dashboard asks for its data again while it is showing. */
const REFRESH_MS = 30_000;
/** How often the minutes to each bus are worked out again. */
const TICK_MS = 15_000;

const CONDITIONS: Record<Conditions, { label: string; icon: (size: number) => ReactNode }> = {
  clear: { label: 'Clear', icon: size => <Sun size={size} aria-hidden="true" /> },
  'partly-cloudy': { label: 'Partly cloudy', icon: size => <CloudSun size={size} aria-hidden="true" /> },
  cloudy: { label: 'Cloudy', icon: size => <Cloud size={size} aria-hidden="true" /> },
  rain: { label: 'Rain', icon: size => <CloudRain size={size} aria-hidden="true" /> },
  snow: { label: 'Snow', icon: size => <CloudSnow size={size} aria-hidden="true" /> }
};

function minutesUntil(arrival: Arrival, now: Date): string {
  const minutes = Math.floor((Date.parse(arrival.due) - now.getTime()) / 60_000);
  return minutes < 1 ? 'Due' : `${minutes} min`;
}

function Unavailable({ children }: Readonly<{ children: string }>) {
  return <p className="dashboard-unavailable">{children}</p>;
}

function ArrivalsPanel({ arrivals, now }: Readonly<{ arrivals: Arrivals | null; now: Date }>) {
  const fresh = arrivals && isFresh(arrivals.updatedAt, ARRIVALS_MAX_AGE_MS, now) ? arrivals : null;
  // A bus that has already gone is dropped at once, without waiting for the next read.
  const stops = fresh?.stops
    .map(stop => ({
      ...stop,
      arrivals: stop.arrivals.filter(arrival => Date.parse(arrival.due) > now.getTime() - 60_000)
    }))
    .filter(stop => stop.arrivals.length > 0);
  return (
    <section className="dashboard-panel dashboard-arrivals" aria-labelledby="dashboard-arrivals-title">
      <h2 id="dashboard-arrivals-title" className="dashboard-title">
        <Bus aria-hidden="true" /> Buses
      </h2>
      {stops && stops.length > 0 ? (
        stops.map(stop => (
          <div key={stop.name} className="dashboard-stop">
            <h3 className="dashboard-stop-name">{stop.name}</h3>
            <ul className="dashboard-arrival-list">
              {stop.arrivals.map(arrival => (
                <li key={`${arrival.route}-${arrival.due}`} className="dashboard-arrival">
                  <span className="dashboard-route">{arrival.route}</span>
                  <span className="dashboard-destination">{arrival.destination}</span>
                  <span className="dashboard-due">{minutesUntil(arrival, now)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))
      ) : (
        <Unavailable>Bus times aren't available</Unavailable>
      )}
    </section>
  );
}

function WeatherPanel({
  weather,
  now,
  clockFormat
}: Readonly<{ weather: Weather | null; now: Date; clockFormat: ClockFormat }>) {
  const fresh = weather && isFresh(weather.updatedAt, WEATHER_MAX_AGE_MS, now) ? weather : null;
  return (
    <section className="dashboard-panel dashboard-weather" aria-labelledby="dashboard-weather-title">
      <h2 id="dashboard-weather-title" className="dashboard-title">
        {CONDITIONS[fresh?.conditions ?? 'partly-cloudy'].icon(28)} {fresh ? fresh.location : 'Weather'}
      </h2>
      {fresh ? (
        <>
          <div className="dashboard-now">
            <span className="dashboard-temperature">{fresh.temperature}°</span>
            <div className="dashboard-now-details">
              <span>{CONDITIONS[fresh.conditions].label}</span>
              <span className="dashboard-range">
                {fresh.high}° / {fresh.low}°
              </span>
            </div>
          </div>
          <ol className="dashboard-hours">
            {fresh.hours.map(hour => (
              <li key={hour.time} className="dashboard-hour">
                <span className="dashboard-hour-time">{formatClockTime(new Date(hour.time), clockFormat)}</span>
                {CONDITIONS[hour.conditions].icon(30)}
                <span className="sr-only">{CONDITIONS[hour.conditions].label}</span>
                <span className="dashboard-hour-temperature">{hour.temperature}°</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <Unavailable>The weather isn't available</Unavailable>
      )}
    </section>
  );
}

/**
 * The Dashboard tab: the next buses and the weather. Reads its data only while `shown`, for the stops and place in the
 * owner's `config` (null before anyone owns the kiosk).
 */
export default function Dashboard({
  shown,
  clockFormat = DEFAULT_CLOCK_FORMAT,
  config = null
}: Readonly<{ shown: boolean; clockFormat?: ClockFormat; config?: TouchscreenConfig | null }>) {
  // Read again when the owner's stops or place change (in Settings here or on the settings site), not the skin.
  const arrivalsSettings = config?.arrivals;
  const weatherSettings = config?.weather;
  const settings = useMemo(
    () => (arrivalsSettings && weatherSettings ? { arrivals: arrivalsSettings, weather: weatherSettings } : null),
    [arrivalsSettings, weatherSettings]
  );
  const [data, setData] = useState<DashboardData>({ arrivals: null, weather: null });
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!shown) return;
    let cancelled = false;
    const load = async () => {
      try {
        const loaded = await getDashboardData(settings);
        if (cancelled) return;
        setNow(new Date());
        setData(loaded);
      } catch (caught) {
        debugLog('error', 'dashboard', `Could not read the dashboard: ${errorMessage(caught)}`);
      }
    };
    void load();
    const refresh = setInterval(() => void load(), REFRESH_MS);
    const tick = setInterval(() => setNow(new Date()), TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [shown, settings]);

  return (
    <div className="dashboard">
      <ArrivalsPanel arrivals={data.arrivals} now={now} />
      <WeatherPanel weather={data.weather} now={now} clockFormat={clockFormat} />
    </div>
  );
}
