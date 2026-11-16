import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Bus,
  CalendarDays,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudSun,
  MapPin,
  Megaphone,
  Sun,
  TrainFront,
  X
} from 'lucide-react';
import { ARRIVALS_MAX_AGE_MS, getDashboardData, isFresh, WEATHER_MAX_AGE_MS } from '../dashboard/data';
import type { Arrival, Arrivals, Conditions, DashboardData, Notice, Weather } from '../dashboard/data';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';
import { DEFAULT_CLOCK_FORMAT, formatClockTime } from '../utils/clockFormat';
import type { ClockFormat } from '../utils/clockFormat';
import type { DashboardLayout } from '../utils/dashboardLayout';
import Modal from './Modal';

/** How often the Dashboard asks for its data again while it is showing. */
const REFRESH_MS = 30_000;
/** How often the minutes to each departure are worked out again. */
const TICK_MS = 15_000;
/** Departures each card shows; the CSS drops the last on a short screen. */
const DEPARTURES_SHOWN = 3;

const CONDITIONS: Record<Conditions, { label: string; icon: (size: number) => ReactNode }> = {
  clear: { label: 'Clear', icon: size => <Sun size={size} aria-hidden="true" /> },
  'partly-cloudy': { label: 'Partly cloudy', icon: size => <CloudSun size={size} aria-hidden="true" /> },
  cloudy: { label: 'Cloudy', icon: size => <Cloud size={size} aria-hidden="true" /> },
  rain: { label: 'Rain', icon: size => <CloudRain size={size} aria-hidden="true" /> },
  snow: { label: 'Snow', icon: size => <CloudSnow size={size} aria-hidden="true" /> }
};

/** TfL's line colours, and the text that reads on each. */
const LINE_COLOURS: Record<string, readonly [string, string]> = {
  Bakerloo: ['#b36305', '#fff'],
  Central: ['#e32017', '#fff'],
  Circle: ['#ffd300', '#000'],
  District: ['#00782a', '#fff'],
  DLR: ['#00a4a7', '#fff'],
  Elizabeth: ['#6950a1', '#fff'],
  'Hammersmith & City': ['#f3a9bb', '#000'],
  Jubilee: ['#a0a5a9', '#000'],
  Metropolitan: ['#9b0056', '#fff'],
  Northern: ['#000', '#fff'],
  Overground: ['#ee7c0e', '#fff'],
  Piccadilly: ['#003688', '#fff'],
  Victoria: ['#0098d4', '#fff'],
  'Waterloo & City': ['#95cdba', '#000']
};

function minutesUntil(arrival: Arrival, now: Date): string {
  const minutes = Math.floor((Date.parse(arrival.due) - now.getTime()) / 60_000);
  return minutes < 1 ? 'Due' : `${minutes} min`;
}

function Unavailable({ children }: Readonly<{ children: string }>) {
  return <p className="dashboard-unavailable">{children}</p>;
}

/** A tube line's name on its own colour, or a bus route's number on red. */
function LineBadge({ mode, line }: Readonly<{ mode: 'tube' | 'bus'; line: string }>) {
  if (mode === 'bus') return <span className="dashboard-line dashboard-line-bus">{line}</span>;
  const [background, ink] = LINE_COLOURS[line] ?? ['var(--accent)', 'var(--accent-ink)'];
  return (
    <span className="dashboard-line" style={{ '--line': background, '--line-ink': ink } as CSSProperties}>
      {line}
    </span>
  );
}

const DEPARTURE_CARDS = {
  tube: { title: 'Tube', icon: <TrainFront aria-hidden="true" />, missing: "Tube times aren't available" },
  bus: { title: 'Buses', icon: <Bus aria-hidden="true" />, missing: "Bus times aren't available" }
} as const;

/** The next departures of one kind, from the first stop that has any. */
function DeparturesCard({
  mode,
  arrivals,
  now
}: Readonly<{ mode: 'tube' | 'bus'; arrivals: Arrivals | null; now: Date }>) {
  const fresh = arrivals && isFresh(arrivals.updatedAt, ARRIVALS_MAX_AGE_MS, now) ? arrivals : null;
  // A departure that has already gone is dropped at once, without waiting for the next read.
  const stop = fresh?.stops
    .filter(candidate => candidate.mode === mode)
    .map(candidate => ({
      ...candidate,
      arrivals: candidate.arrivals.filter(arrival => Date.parse(arrival.due) > now.getTime() - 60_000)
    }))
    .find(candidate => candidate.arrivals.length > 0);
  const card = DEPARTURE_CARDS[mode];
  const titleId = `dashboard-${mode}-title`;
  return (
    <section className="dashboard-departures" aria-labelledby={titleId}>
      <h2 id={titleId} className="dashboard-card-title">
        {card.icon} {card.title}
        {stop && <span className="dashboard-stop-name">{stop.name}</span>}
      </h2>
      {stop ? (
        <ul className="dashboard-arrival-list">
          {stop.arrivals.slice(0, DEPARTURES_SHOWN).map(arrival => (
            <li key={`${arrival.route}-${arrival.due}`} className="dashboard-arrival">
              <LineBadge mode={mode} line={arrival.route} />
              <span className="dashboard-destination">{arrival.destination}</span>
              <span className="dashboard-due">{minutesUntil(arrival, now)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Unavailable>{card.missing}</Unavailable>
      )}
    </section>
  );
}

/** The current weather over a picture of the sky, with the next three hours. */
function WeatherHero({
  weather,
  now,
  clockFormat,
  clock = false
}: Readonly<{ weather: Weather | null; now: Date; clockFormat: ClockFormat; clock?: boolean }>) {
  const fresh = weather && isFresh(weather.updatedAt, WEATHER_MAX_AGE_MS, now) ? weather : null;
  return (
    <section className="dashboard-weather" aria-label={fresh ? `Weather in ${fresh.location}` : 'Weather'}>
      {clock && (
        <div className="dashboard-clock">
          <span className="dashboard-clock-time">{formatClockTime(now, clockFormat)}</span>
          <span className="dashboard-clock-date">
            {now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
        </div>
      )}
      {fresh ? (
        <>
          <div className="dashboard-now">
            <span className="dashboard-place">
              <MapPin aria-hidden="true" /> {fresh.location}
            </span>
            <span className="dashboard-temperature">{fresh.temperature}°</span>
            <span className="dashboard-conditions">{CONDITIONS[fresh.conditions].label}</span>
          </div>
          <ol className="dashboard-hours">
            {fresh.hours.slice(0, 3).map(hour => (
              <li key={hour.time} className="dashboard-hour">
                <span className="dashboard-hour-time">{formatClockTime(new Date(hour.time), clockFormat)}</span>
                {CONDITIONS[hour.conditions].icon(34)}
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

/** What a notice is about, drawn rather than written: the line or route badge, or an icon. */
function NoticeMark({ notice }: Readonly<{ notice: Notice }>) {
  if ((notice.kind === 'tube' || notice.kind === 'bus') && notice.line) {
    return <LineBadge mode={notice.kind} line={notice.line} />;
  }
  const icon = notice.kind === 'weather' ? <CloudRain aria-hidden="true" /> : <CalendarDays aria-hidden="true" />;
  return <span className="dashboard-notice-icon">{icon}</span>;
}

/** The notices, each as its badge, a two or three word status and when; tapping one shows the provider's full text. */
function NoticeBoard({ notices }: Readonly<{ notices: Notice[] }>) {
  const [open, setOpen] = useState<Notice | null>(null);
  if (notices.length === 0) return null;
  return (
    <section className="dashboard-notices" aria-label="Notice board">
      <h2 className="dashboard-card-title dashboard-notices-title">
        <Megaphone aria-hidden="true" /> Notices
      </h2>
      <ul className="dashboard-notice-list">
        {notices.map(notice => (
          <li key={notice.id}>
            <button
              type="button"
              className="dashboard-notice"
              data-severity={notice.severity}
              aria-label={notice.title}
              onClick={() => setOpen(notice)}
            >
              <NoticeMark notice={notice} />
              <span className="dashboard-notice-text">
                <span className="dashboard-notice-status">{notice.status}</span>
                {notice.when && <span className="dashboard-notice-when">{notice.when}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <Modal
          labelledBy="dashboard-notice-title"
          onClose={() => setOpen(null)}
          className="app-modal-panel notice-sheet"
        >
          <div className="notice-sheet-header">
            <NoticeMark notice={open} />
            <h3 id="dashboard-notice-title" className="notice-sheet-title">
              {open.title}
            </h3>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(null)}
              className="modal-icon-button notice-sheet-close rounded-full flex items-center justify-center"
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <p className="notice-sheet-detail">{open.detail}</p>
        </Modal>
      )}
    </section>
  );
}

/**
 * The Dashboard tab: the weather, the next Tube and buses, and the notice board, in the layout picked in Settings >
 * Appearance. Reads its data only while `shown`.
 */
export default function Dashboard({
  shown,
  clockFormat = DEFAULT_CLOCK_FORMAT,
  layout = 'column'
}: Readonly<{ shown: boolean; clockFormat?: ClockFormat; layout?: DashboardLayout }>) {
  const [data, setData] = useState<DashboardData>({ arrivals: null, weather: null, notices: [] });
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!shown) return;
    let cancelled = false;
    const load = async () => {
      try {
        const loaded = await getDashboardData();
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
  }, [shown]);

  return (
    <div className="dashboard" data-layout={layout}>
      <WeatherHero weather={data.weather} now={now} clockFormat={clockFormat} clock={layout === 'clock'} />
      <DeparturesCard mode="tube" arrivals={data.arrivals} now={now} />
      <DeparturesCard mode="bus" arrivals={data.arrivals} now={now} />
      <NoticeBoard notices={data.notices} />
    </div>
  );
}
