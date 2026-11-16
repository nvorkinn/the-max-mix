import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { TouchscreenConfig } from 'countdown-api';
import { BusFront, CalendarDays, ChevronRight, CloudRain, MapPin, Megaphone, Umbrella, X } from 'lucide-react';
import { ARRIVALS_MAX_AGE_MS, getDashboardData, isFresh, WEATHER_MAX_AGE_MS } from '../dashboard/data';
import type { Arrival, Arrivals, Conditions, DashboardData, Notice, Weather } from '../dashboard/data';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';
import { DEFAULT_CLOCK_FORMAT, formatClockTime } from '../utils/clockFormat';
import type { ClockFormat } from '../utils/clockFormat';
import { DEFAULT_DASHBOARD_LAYOUT } from '../utils/dashboardLayout';
import type { DashboardLayout } from '../utils/dashboardLayout';
import londonPhoto from '../assets/dashboard/london-sunset-fallback.jpg';
import clearWeather from '../assets/dashboard/weather/clear.webp';
import partlyCloudyWeather from '../assets/dashboard/weather/partly-cloudy.webp';
import cloudyWeather from '../assets/dashboard/weather/cloudy.webp';
import rainWeather from '../assets/dashboard/weather/rain.webp';
import snowWeather from '../assets/dashboard/weather/snow.webp';
import Modal from './Modal';

/** How often the Dashboard asks for its data again while it is showing. */
const REFRESH_MS = 30_000;
/** How often the minutes to each departure are worked out again. */
const TICK_MS = 15_000;
/** Departures each card shows. */
const DEPARTURES_SHOWN = 2;
/** Departures each board shows in the List layout, where the boards stand tall over the backdrop. */
const LIST_DEPARTURES_SHOWN = 6;
/** Hours of forecast on the Modular layout's Later today tile. */
const HOURS_SHOWN = 3;
/** Hours of forecast across the top right of the List layout. */
const LIST_HOURS_SHOWN = 5;
/** Hours of forecast in the Timeline layout's weather strip. */
const TIMELINE_HOURS_SHOWN = 4;
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

/** Transparent atmospheric weather artwork. The same condition uses coordinated art at both sizes. */
const WEATHER_IMAGES: Record<Conditions, string> = {
  clear: clearWeather,
  'partly-cloudy': partlyCloudyWeather,
  cloudy: cloudyWeather,
  rain: rainWeather,
  snow: snowWeather
};

function WeatherIcon({ conditions, hero = false }: Readonly<{ conditions: Conditions; hero?: boolean }>) {
  return (
    <img
      src={WEATHER_IMAGES[conditions]}
      className={`weather-icon${hero ? ' weather-icon-hero' : ''}`}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
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
    next: 'Next Tube',
    icon: <Roundel className="dashboard-card-mark" />,
    missing: "Tube times aren't available"
  },
  bus: {
    title: 'Buses',
    next: 'Next Buses',
    icon: (
      <span className="dashboard-card-mark dashboard-bus-mark">
        <BusFront aria-hidden="true" />
      </span>
    ),
    missing: "Bus times aren't available"
  }
} as const;

/** The first stop of one kind that has departures still to come, or none while the departures are missing or old. */
function nextStop(mode: 'tube' | 'bus', arrivals: Arrivals | null, now: Date, count = DEPARTURES_SHOWN) {
  const fresh = arrivals && isFresh(arrivals.updatedAt, ARRIVALS_MAX_AGE_MS, now) ? arrivals : null;
  // A departure that has already gone is dropped at once, without waiting for the next read.
  return fresh?.stops
    .filter(candidate => candidate.mode === mode)
    .map(candidate => ({
      ...candidate,
      arrivals: candidate.arrivals.filter(arrival => Date.parse(arrival.due) > now.getTime() - 60_000).slice(0, count)
    }))
    .find(candidate => candidate.arrivals.length > 0);
}

/** How long until a departure, on its chip: green when it is time to go. */
function Due({ arrival, now }: Readonly<{ arrival: Arrival; now: Date }>) {
  const minutes = minutesUntil(arrival, now);
  return (
    <span className="dashboard-due" data-soon={minutes <= SOON_MINUTES}>
      {minutes < 1 ? 'Due' : `${minutes} min`}
    </span>
  );
}

/** The next departures of one kind, from the first stop that has any. The Banner layout leaves the stop's name out. */
function DeparturesCard({
  mode,
  arrivals,
  now,
  layout
}: Readonly<{ mode: 'tube' | 'bus'; arrivals: Arrivals | null; now: Date; layout: DashboardLayout }>) {
  const stop = nextStop(mode, arrivals, now, layout === 'list' ? LIST_DEPARTURES_SHOWN : DEPARTURES_SHOWN);
  const card = DEPARTURE_CARDS[mode];
  const titleId = `dashboard-${mode}-title`;
  const banner = layout === 'banner';
  return (
    <section className="dashboard-card dashboard-departures" data-mode={mode} aria-labelledby={titleId}>
      <header className="dashboard-departures-header">
        {card.icon}
        <h2 id={titleId} className="dashboard-departures-title">
          {banner ? card.next : card.title}
        </h2>
        {stop && !banner && (
          <span className="dashboard-stop-name">
            {stop.name}
            <ChevronRight aria-hidden="true" />
          </span>
        )}
      </header>
      {stop ? (
        <ul className="dashboard-arrival-list">
          {stop.arrivals.map(arrival => (
            <li key={`${arrival.route}-${arrival.due}`} className="dashboard-arrival">
              <LineBadge mode={mode} line={arrival.route} />
              <span className="dashboard-destination">
                <span className="dashboard-destination-name">{arrival.destination}</span>
                {arrival.stop && !banner && <span className="dashboard-destination-stop">{arrival.stop}</span>}
              </span>
              <Due arrival={arrival} now={now} />
            </li>
          ))}
        </ul>
      ) : (
        <Unavailable>{card.missing}</Unavailable>
      )}
    </section>
  );
}

/** The Timeline layout's one card of next departures: the Tube's and then the buses', under the stop's name. */
function NextDepartures({ arrivals, now }: Readonly<{ arrivals: Arrivals | null; now: Date }>) {
  const groups = (['tube', 'bus'] as const)
    .map(mode => ({ mode, stop: nextStop(mode, arrivals, now) }))
    .filter(
      (group): group is { mode: 'tube' | 'bus'; stop: NonNullable<typeof group.stop> } => group.stop !== undefined
    );
  const place = groups[0]?.stop.name;
  return (
    <section
      className="dashboard-card dashboard-next"
      aria-label={place ? `Next departures from ${place}` : 'Next departures'}
    >
      {place ? (
        <>
          <h2 className="dashboard-next-title">
            <MapPin aria-hidden="true" /> {place}
          </h2>
          {groups.map(({ mode, stop }) => (
            <div key={mode} className="dashboard-next-group" data-mode={mode}>
              {DEPARTURE_CARDS[mode].icon}
              <ul className="dashboard-next-list" aria-label={DEPARTURE_CARDS[mode].title}>
                {stop.arrivals.map(arrival => (
                  <li key={`${arrival.route}-${arrival.due}`} className="dashboard-next-arrival">
                    <span className="dashboard-next-route">
                      {arrival.route}
                      <span aria-hidden="true"> → </span>
                      <span className="sr-only"> to </span>
                      {arrival.destination}
                    </span>
                    <Due arrival={arrival} now={now} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      ) : (
        <Unavailable>Departure times aren't available</Unavailable>
      )}
    </section>
  );
}

/** The next few hours of the forecast: the time, the weather drawn and the temperature. */
function Hours({
  weather,
  count,
  clockFormat
}: Readonly<{ weather: Weather; count: number; clockFormat: ClockFormat }>) {
  return (
    <ol className="dashboard-hours">
      {weather.hours.slice(0, count).map(hour => (
        <li key={hour.time} className="dashboard-hour">
          <span className="dashboard-hour-time">{formatClockTime(new Date(hour.time), clockFormat)}</span>
          <WeatherIcon conditions={hour.conditions} />
          <span className="sr-only">{CONDITION_LABELS[hour.conditions]}</span>
          <span className="dashboard-hour-temperature">{hour.temperature}°</span>
        </li>
      ))}
    </ol>
  );
}

function freshWeather(weather: Weather | null, now: Date): Weather | null {
  return weather && isFresh(weather.updatedAt, WEATHER_MAX_AGE_MS, now) ? weather : null;
}

/**
 * The weather, laid out for each layout: List's straight on the backdrop with the next five hours apart from it, top
 * right; Banner's big clock beside it;
 * Timeline's strip of the next hours; Modular's tile with only now.
 */
function WeatherCard({
  weather,
  now,
  clockFormat,
  layout
}: Readonly<{ weather: Weather | null; now: Date; clockFormat: ClockFormat; layout: DashboardLayout }>) {
  const fresh = freshWeather(weather, now);
  const rainLater = fresh?.hours.some(hour => hour.conditions === 'rain') && fresh.conditions !== 'rain';
  const label = fresh ? `Weather in ${fresh.location}` : 'Weather';
  if (layout === 'banner') {
    const date = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    return (
      <section className="dashboard-card dashboard-weather" aria-label={label}>
        <div className="dashboard-clock">
          <span className="dashboard-clock-time">{formatClockTime(now, clockFormat)}</span>
          <span className="dashboard-clock-date">
            {date}
            {fresh && (
              <>
                {' '}
                <span aria-hidden="true">·</span> {fresh.location}
              </>
            )}
          </span>
        </div>
        {fresh ? (
          <div className="dashboard-banner-now">
            <WeatherIcon conditions={fresh.conditions} hero />
            <span className="dashboard-now">
              <span className="dashboard-temperature">{fresh.temperature}°</span>
              <span className="dashboard-conditions">{CONDITION_LABELS[fresh.conditions]}</span>
            </span>
            <span className="dashboard-high-low">
              <span>H: {fresh.high}°</span>
              <span>L: {fresh.low}°</span>
            </span>
          </div>
        ) : (
          <Unavailable>The weather isn't available</Unavailable>
        )}
      </section>
    );
  }
  if (layout === 'timeline') {
    return (
      <section className="dashboard-card dashboard-weather" aria-label={label}>
        {fresh ? (
          <>
            <WeatherIcon conditions={fresh.conditions} hero />
            <span className="dashboard-now">
              <span className="dashboard-temperature">{fresh.temperature}°</span>
              <span className="dashboard-conditions">{CONDITION_LABELS[fresh.conditions]}</span>
            </span>
            <Hours weather={fresh} count={TIMELINE_HOURS_SHOWN} clockFormat={clockFormat} />
          </>
        ) : (
          <Unavailable>The weather isn't available</Unavailable>
        )}
      </section>
    );
  }
  if (layout === 'modular') {
    return (
      <section className="dashboard-card dashboard-weather" aria-label={label}>
        {fresh ? (
          <>
            <span className="dashboard-place">
              <MapPin aria-hidden="true" /> {fresh.location}
            </span>
            <span className="dashboard-modular-weather-hero">
              <span className="dashboard-now">
                <span className="dashboard-temperature">{fresh.temperature}°</span>
                <span className="dashboard-conditions">{CONDITION_LABELS[fresh.conditions]}</span>
                <span className="dashboard-high-low">
                  High {fresh.high}° <span aria-hidden="true">·</span> Low {fresh.low}°
                </span>
              </span>
              <WeatherIcon conditions={fresh.conditions} hero />
            </span>
          </>
        ) : (
          <Unavailable>The weather isn't available</Unavailable>
        )}
      </section>
    );
  }
  const updatedMinutes = fresh ? Math.max(0, Math.floor((now.getTime() - Date.parse(fresh.updatedAt)) / 60_000)) : 0;
  const updatedLabel = updatedMinutes < 2 ? 'Updated just now' : `Updated ${updatedMinutes} min ago`;
  return (
    <>
      <section className="dashboard-card dashboard-weather" aria-label={label}>
        {fresh ? (
          <div className="dashboard-now">
            <span className="dashboard-place">
              <MapPin aria-hidden="true" /> {fresh.location}
            </span>
            <span className="dashboard-weather-label">{updatedLabel}</span>
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
        ) : (
          <Unavailable>The weather isn't available</Unavailable>
        )}
      </section>
      {fresh && (
        <section className="dashboard-forecast" aria-label="Next hours">
          <Hours weather={fresh} count={LIST_HOURS_SHOWN} clockFormat={clockFormat} />
        </section>
      )}
    </>
  );
}

/** The Modular layout's tile of the next hours' weather. */
function LaterToday({
  weather,
  now,
  clockFormat
}: Readonly<{ weather: Weather | null; now: Date; clockFormat: ClockFormat }>) {
  const fresh = freshWeather(weather, now);
  return (
    <section className="dashboard-card dashboard-later" aria-labelledby="dashboard-later-title">
      <h2 id="dashboard-later-title" className="dashboard-later-title">
        Later today
      </h2>
      {fresh ? (
        <Hours weather={fresh} count={HOURS_SHOWN} clockFormat={clockFormat} />
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

/**
 * The notices, each as a headline and one short line; tapping one shows the provider's full text. A list down the
 * side, a strip (Banner), a timeline or a row of tiles (Modular), by the layout. Only shown when there are notices.
 */
function NoticeBoard({ notices, layout }: Readonly<{ notices: Notice[]; layout: DashboardLayout }>) {
  const [open, setOpen] = useState<Notice | null>(null);
  const priority: Record<Notice['severity'], number> = { severe: 0, minor: 1, planned: 2, info: 3 };
  // Weather warnings lead other notices of the same severity; urgent events always outrank minor ones.
  const kindPriority: Record<Notice['kind'], number> = { weather: 0, delays: 1, closure: 2, holiday: 3 };
  const orderedNotices = notices.toSorted(
    (a, b) => priority[a.severity] - priority[b.severity] || kindPriority[a.kind] - kindPriority[b.kind]
  );
  return (
    <section className="dashboard-card dashboard-notices" aria-labelledby="dashboard-notices-title">
      <h2 id="dashboard-notices-title" className="dashboard-notices-title">
        <Megaphone aria-hidden="true" /> {layout === 'timeline' ? 'Notices' : 'Notice board'}
        {layout === 'list' && <span className="dashboard-notice-count">{notices.length} updates</span>}
      </h2>
      <ul className="dashboard-notice-list">
        {orderedNotices.map(notice => (
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
 * The Dashboard tab, in one of the four layouts picked in Settings > Appearance (List by default): the notice board,
 * the weather over a photo, and the next Tube and buses. With no notices the notice board is left out and the rest
 * takes its room. Reads its data only while `shown`, for the stops, place and notice board in the owner's `config`
 * (null before anyone owns the kiosk), and again whenever those change.
 */
export default function Dashboard({
  shown,
  clockFormat = DEFAULT_CLOCK_FORMAT,
  config = null,
  layout = DEFAULT_DASHBOARD_LAYOUT,
  backgroundImageUrl,
  backgroundIncludesWeatherArtwork = false
}: Readonly<{
  shown: boolean;
  clockFormat?: ClockFormat;
  config?: TouchscreenConfig | null;
  layout?: DashboardLayout;
  /** URL of an externally supplied daily scene. Omit to use the bundled fallback. */
  backgroundImageUrl?: string;
  /** Set true if the daily scene already depicts the current condition (e.g. sun and clouds). */
  backgroundIncludesWeatherArtwork?: boolean;
}>) {
  // Only the Dashboard's own sections: a change of skin or screen sleep doesn't read the data again.
  const arrivalsSettings = config?.arrivals;
  const weatherSettings = config?.weather;
  const noticeBoardSettings = config?.notice_board;
  const settings = useMemo(
    () =>
      arrivalsSettings && weatherSettings && noticeBoardSettings
        ? { arrivals: arrivalsSettings, weather: weatherSettings, notice_board: noticeBoardSettings }
        : null,
    [arrivalsSettings, weatherSettings, noticeBoardSettings]
  );
  const [data, setData] = useState<DashboardData>({ arrivals: null, weather: null, notices: [] });
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!shown) return;
    let cancelled = false;
    const load = async () => {
      try {
        const loaded = await getDashboardData(settings, new Date(), clockFormat);
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
  }, [shown, settings, clockFormat]);

  const hasNotices = data.notices.length > 0;
  // This is a presentation contract only: the daily-image generator and caching live elsewhere.
  const sceneUrl = backgroundImageUrl || londonPhoto;
  const scene = `url(${JSON.stringify(sceneUrl)})`;
  return (
    <div
      className="dashboard"
      data-layout={layout}
      data-notices={hasNotices ? 'some' : 'none'}
      data-weather-artwork={backgroundIncludesWeatherArtwork || !backgroundImageUrl ? 'integrated' : 'separate'}
      style={{ '--weather-photo': scene } as CSSProperties}
    >
      {hasNotices && <NoticeBoard notices={data.notices} layout={layout} />}
      <WeatherCard weather={data.weather} now={now} clockFormat={clockFormat} layout={layout} />
      {layout === 'timeline' ? (
        <NextDepartures arrivals={data.arrivals} now={now} />
      ) : (
        <>
          <DeparturesCard mode="tube" arrivals={data.arrivals} now={now} layout={layout} />
          <DeparturesCard mode="bus" arrivals={data.arrivals} now={now} layout={layout} />
        </>
      )}
      {layout === 'modular' && <LaterToday weather={data.weather} now={now} clockFormat={clockFormat} />}
    </div>
  );
}
