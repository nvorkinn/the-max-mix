import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { BusFront, CalendarDays, ChevronRight, CloudRain, MapPin, Megaphone, Umbrella, X } from 'lucide-react';
import { ARRIVALS_MAX_AGE_MS, getDashboardData, isFresh, WEATHER_MAX_AGE_MS } from '../dashboard/data';
import type { Arrival, Arrivals, Conditions, DashboardData, Notice, Weather } from '../dashboard/data';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';
import { DEFAULT_CLOCK_FORMAT, formatClockTime } from '../utils/clockFormat';
import type { ClockFormat } from '../utils/clockFormat';
import londonPhoto from '../assets/dashboard/london.jpg';
import Modal from './Modal';

/** How often the Dashboard asks for its data again while it is showing. */
const REFRESH_MS = 30_000;
/** How often the minutes to each departure are worked out again. */
const TICK_MS = 15_000;
/** Departures each card shows. */
const DEPARTURES_SHOWN = 2;
/** Hours of forecast beside the temperature. */
const HOURS_SHOWN = 3;
/** A departure this many minutes away or fewer gets the green chip: time to go. */
const SOON_MINUTES = 5;

const CONDITION_LABELS: Record<Conditions, string> = {
  clear: 'Clear',
  'partly-cloudy': 'Partly cloudy',
  cloudy: 'Cloudy',
  rain: 'Rain',
  snow: 'Snow'
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

/** A yellow sun with its rays, at (cx, cy). */
function sunAt(cx: number, cy: number, r: number) {
  return (
    <g className="weather-icon-sun">
      {Array.from({ length: 8 }, (_, ray) => {
        const angle = (ray * Math.PI) / 4;
        return (
          <line
            key={ray}
            x1={cx + Math.cos(angle) * (r + 3)}
            y1={cy + Math.sin(angle) * (r + 3)}
            x2={cx + Math.cos(angle) * (r + 7)}
            y2={cy + Math.sin(angle) * (r + 7)}
          />
        );
      })}
      <circle cx={cx} cy={cy} r={r} />
    </g>
  );
}

/** The weather drawn in colour: a white cloud, a yellow sun, blue rain and snow. */
function WeatherIcon({ conditions, hero = false }: Readonly<{ conditions: Conditions; hero?: boolean }>) {
  const cloud = (
    <path className="weather-icon-cloud" d="M15 44h30a10 10 0 0 0 1-20 14 14 0 0 0-27-4 11 11 0 0 0-4 24z" />
  );
  return (
    <svg viewBox="0 0 60 60" className={`weather-icon${hero ? ' weather-icon-hero' : ''}`} aria-hidden="true">
      {conditions === 'clear' && sunAt(30, 30, 12)}
      {conditions === 'partly-cloudy' && sunAt(38, 20, 9)}
      {conditions !== 'clear' && cloud}
      {conditions === 'rain' &&
        [20, 30, 40].map(x => <line key={x} className="weather-icon-rain" x1={x} y1={49} x2={x - 3} y2={56} />)}
      {conditions === 'snow' &&
        [20, 30, 40].map(x => <circle key={x} className="weather-icon-snow" cx={x} cy={52} r={2.4} />)}
    </svg>
  );
}

/** TfL's roundel. */
function Roundel({ className = '' }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 64 40" className={`tfl-roundel ${className}`} aria-hidden="true">
      <circle cx="32" cy="20" r="15" fill="none" stroke="#dc241f" strokeWidth="7" />
      <rect x="4" y="16" width="56" height="8" fill="#0019a8" />
    </svg>
  );
}

function minutesUntil(arrival: Arrival, now: Date): number {
  return Math.floor((Date.parse(arrival.due) - now.getTime()) / 60_000);
}

function Unavailable({ children }: Readonly<{ children: string }>) {
  return <p className="dashboard-unavailable">{children}</p>;
}

/** A Tube line's name on its colour, or a bus route's number on red. */
function LineBadge({ mode, line }: Readonly<{ mode: 'tube' | 'bus'; line: string }>) {
  if (mode === 'bus') return <span className="dashboard-route dashboard-route-bus">{line}</span>;
  const [background, ink] = LINE_COLOURS[line] ?? ['#000', '#fff'];
  return (
    <span className="dashboard-route" style={{ '--line': background, '--line-ink': ink } as CSSProperties}>
      {line}
    </span>
  );
}

const DEPARTURE_CARDS = {
  tube: {
    title: 'Tube',
    icon: <Roundel className="dashboard-card-mark" />,
    missing: "Tube times aren't available"
  },
  bus: {
    title: 'Buses',
    icon: (
      <span className="dashboard-card-mark dashboard-bus-mark">
        <BusFront aria-hidden="true" />
      </span>
    ),
    missing: "Bus times aren't available"
  }
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
    <section className="dashboard-card dashboard-departures" data-mode={mode} aria-labelledby={titleId}>
      <header className="dashboard-departures-header">
        {card.icon}
        <h2 id={titleId} className="dashboard-departures-title">
          {card.title}
        </h2>
        {stop && (
          <span className="dashboard-stop-name">
            {stop.name}
            <ChevronRight aria-hidden="true" />
          </span>
        )}
      </header>
      {stop ? (
        <ul className="dashboard-arrival-list">
          {stop.arrivals.slice(0, DEPARTURES_SHOWN).map(arrival => {
            const minutes = minutesUntil(arrival, now);
            return (
              <li key={`${arrival.route}-${arrival.due}`} className="dashboard-arrival">
                <LineBadge mode={mode} line={arrival.route} />
                <span className="dashboard-destination">
                  <span className="dashboard-destination-name">{arrival.destination}</span>
                  {arrival.stop && <span className="dashboard-destination-stop">{arrival.stop}</span>}
                </span>
                <span className="dashboard-due" data-soon={minutes <= SOON_MINUTES}>
                  {minutes < 1 ? 'Due' : `${minutes} min`}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <Unavailable>{card.missing}</Unavailable>
      )}
    </section>
  );
}

/** The weather over a photo of the place: now, the next three hours, and whether rain comes later. */
function WeatherCard({
  weather,
  now,
  clockFormat
}: Readonly<{ weather: Weather | null; now: Date; clockFormat: ClockFormat }>) {
  const fresh = weather && isFresh(weather.updatedAt, WEATHER_MAX_AGE_MS, now) ? weather : null;
  const rainLater = fresh?.hours.some(hour => hour.conditions === 'rain') && fresh.conditions !== 'rain';
  return (
    <section
      className="dashboard-card dashboard-weather"
      aria-label={fresh ? `Weather in ${fresh.location}` : 'Weather'}
    >
      {fresh ? (
        <>
          <div className="dashboard-weather-topline">
            <span className="dashboard-place">
              <MapPin aria-hidden="true" /> {fresh.location}
            </span>
            <span className="dashboard-weather-label">Local weather</span>
          </div>
          <div className="dashboard-weather-hero">
            <div className="dashboard-now">
              <span className="dashboard-temperature">{fresh.temperature}°</span>
              <span className="dashboard-conditions">{CONDITION_LABELS[fresh.conditions]}</span>
              <span className="dashboard-high-low">
                High {fresh.high}° <span aria-hidden="true">·</span> Low {fresh.low}°
              </span>
              {rainLater && (
                <span className="dashboard-outlook">
                  <Umbrella aria-hidden="true" /> Rain later today
                </span>
              )}
            </div>
            <WeatherIcon conditions={fresh.conditions} hero />
          </div>
          <div className="dashboard-hours-wrap">
            <span className="dashboard-hours-label">Next hours</span>
            <ol className="dashboard-hours">
              {fresh.hours.slice(0, HOURS_SHOWN).map(hour => (
                <li key={hour.time} className="dashboard-hour">
                  <span className="dashboard-hour-time">{formatClockTime(new Date(hour.time), clockFormat)}</span>
                  <WeatherIcon conditions={hour.conditions} />
                  <span className="sr-only">{CONDITION_LABELS[hour.conditions]}</span>
                  <span className="dashboard-hour-temperature">{hour.temperature}°</span>
                </li>
              ))}
            </ol>
          </div>
        </>
      ) : (
        <Unavailable>The weather isn't available</Unavailable>
      )}
    </section>
  );
}

const NOTICE_ICONS: Record<Notice['kind'], () => ReactNode> = {
  weather: () => <CloudRain aria-hidden="true" />,
  delays: () => (
    <svg viewBox="0 0 24 24" className="dashboard-notice-warning" aria-hidden="true">
      <path d="M12 2.5 23 21.5H1z" />
      <rect x="10.8" y="9" width="2.4" height="6.5" rx="1" />
      <circle cx="12" cy="18.2" r="1.4" />
    </svg>
  ),
  holiday: () => <CalendarDays aria-hidden="true" />,
  closure: () => <Roundel />
};

/** A notice's icon on its tinted tile. */
function NoticeIcon({ notice }: Readonly<{ notice: Notice }>) {
  return (
    <span className="dashboard-notice-icon" data-kind={notice.kind}>
      {NOTICE_ICONS[notice.kind]()}
    </span>
  );
}

/** The notices, each as a headline and one short line; tapping one shows the provider's full text. */
function NoticeBoard({ notices }: Readonly<{ notices: Notice[] }>) {
  const [open, setOpen] = useState<Notice | null>(null);
  return (
    <section className="dashboard-card dashboard-notices" aria-labelledby="dashboard-notices-title">
      <h2 id="dashboard-notices-title" className="dashboard-notices-title">
        <Megaphone aria-hidden="true" /> Notice board
        <span className="dashboard-notice-count">{notices.length} updates</span>
      </h2>
      <ul className="dashboard-notice-list">
        {notices.length === 0 && <li className="dashboard-notice-empty">Nothing requiring your attention</li>}
        {notices.map(notice => (
          <li key={notice.id}>
            <button
              type="button"
              className="dashboard-notice"
              data-severity={notice.severity}
              onClick={() => setOpen(notice)}
            >
              <NoticeIcon notice={notice} />
              <span className="dashboard-notice-text">
                <span className="dashboard-notice-title">{notice.title}</span>
                <span className="dashboard-notice-summary">{notice.summary}</span>
              </span>
              <ChevronRight className="dashboard-notice-chevron" aria-hidden="true" />
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
            <NoticeIcon notice={open} />
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
 * The Dashboard tab: the notice board down the left, the weather over a photo, and the next Tube and buses under it.
 * Reads its data only while `shown`.
 */
export default function Dashboard({
  shown,
  clockFormat = DEFAULT_CLOCK_FORMAT
}: Readonly<{ shown: boolean; clockFormat?: ClockFormat }>) {
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
    // Visual placeholder only. The background-image provider is being implemented separately.
    <div className="dashboard" style={{ '--weather-photo': `url(${londonPhoto})` } as CSSProperties}>
      <NoticeBoard notices={data.notices} />
      <WeatherCard weather={data.weather} now={now} clockFormat={clockFormat} />
      <DeparturesCard mode="tube" arrivals={data.arrivals} now={now} />
      <DeparturesCard mode="bus" arrivals={data.arrivals} now={now} />
    </div>
  );
}
