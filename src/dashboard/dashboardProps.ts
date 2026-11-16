// The redesigned Dashboard's data, in its components' props (props.ts), from what the live feed last gave (live.ts):
// the Tube and Bus boards (boards.ts), the weather block and hourly strip (weatherViews.ts) and the notice board
// (notices.ts's notices, in the board's kinds and colours). The layout never depends on the data: a board, the
// weather or the notices that the server has nothing for are null or empty, and each component keeps its space.
//
// Stale: once the feed has been down for STALE_AFTER_MS, everything is; before that, a board is stale while any of its
// stops' departures are held from before (their provider is down) or were read longer ago than DEPARTURES_STALE_MS, and
// the hourly strip while the forecast is held or older than WEATHER_STALE_MS.

import type { DashboardProps } from '../components/Dashboard';
import type { ClockFormat } from '../utils/clockFormat';
import { toBoards } from './boards';
import type { Notice } from './data';
import type { LiveSnapshot } from './live';
import { boardNotices } from './notices';
import type { NoticeItem, NoticeKind, NoticeSeverity } from './props';
import { toWeather } from './weatherViews';

/** The feed can drop for a moment (a server restart); only this long without it shows as stale. */
export const STALE_AFTER_MS = 30_000;
/** countdown's providers read departures every 30 s: older than this, the provider has stopped. */
export const DEPARTURES_STALE_MS = 2 * 60_000;
/** The weather provider reads a forecast at least every 15 minutes. */
export const WEATHER_STALE_MS = 45 * 60_000;

/** Everything the Dashboard draws but the tab bar, which the app's shell gives it. */
export type LiveProps = Omit<DashboardProps, 'tabBar'>;

/** A notice-board notice (notices.ts) as a row of the board. */
export function toNoticeItem(notice: Notice): NoticeItem {
  const planned = notice.severity === 'planned';
  const kinds: Record<Notice['kind'], NoticeKind> = {
    weather: 'weather-warning',
    holiday: 'bank-holiday',
    closure: planned ? 'planned-works' : 'closure',
    delays: planned ? 'planned-works' : 'delays'
  };
  const kind = kinds[notice.kind];
  let severity: NoticeSeverity;
  if (planned) severity = 'planned';
  else if (notice.severity === 'info') severity = 'info';
  // Weather warnings, and closures and suspensions in force, are red; a closure never looks milder than a delay.
  else if (kind === 'weather-warning' || kind === 'closure' || notice.severity === 'severe') severity = 'severe';
  else severity = 'disruption';
  const detail = notice.detail.trim();
  const saysMore = !['', notice.summary, notice.title].includes(detail);
  return {
    id: notice.id,
    kind,
    severity,
    title: notice.title,
    summary: notice.summary,
    detail: saysMore ? detail : null
  };
}

const SEVERITY_ORDER: readonly NoticeSeverity[] = ['severe', 'disruption', 'planned', 'info', 'everyday'];

/** The board's rows, most urgent first (notices.ts's order kept among equals). */
function toNoticeItems(snapshot: LiveSnapshot, now: Date, clockFormat: ClockFormat): NoticeItem[] {
  return snapshot.notices
    ? boardNotices(snapshot.notices, now, clockFormat)
        .map(notice => toNoticeItem(notice))
        .map((item, index) => ({ item, index }))
        .toSorted(
          (a, b) =>
            SEVERITY_ORDER.indexOf(a.item.severity) - SEVERITY_ORDER.indexOf(b.item.severity) || a.index - b.index
        )
        .map(({ item }) => item)
    : [];
}

/** Whether the feed has been down long enough to say so. */
function feedStale(snapshot: LiveSnapshot, now: Date): boolean {
  return snapshot.downSince !== null && now.getTime() - snapshot.downSince >= STALE_AFTER_MS;
}

const olderThan = (time: string | undefined, ms: number, now: Date) =>
  time !== undefined && now.getTime() - Date.parse(time) > ms;

/** The Dashboard's props from `snapshot`, as of `now`. */
export function dashboardProps(snapshot: LiveSnapshot, now: Date, clockFormat: ClockFormat): LiveProps {
  const down = feedStale(snapshot, now);
  const boards = toBoards(snapshot.arrivals, now);
  const fetchedAt = new Map(
    (snapshot.arrivals?.stops ?? []).flatMap(stop => (stop.departures ? [[stop.id, stop.departures.fetched_at]] : []))
  );
  const boardStale = (stopIds: readonly string[]) =>
    down || stopIds.some(id => snapshot.heldStops.has(id) || olderThan(fetchedAt.get(id), DEPARTURES_STALE_MS, now));

  const weather = toWeather(snapshot.weather, now, clockFormat);
  const weatherRead = snapshot.weather?.forecast?.fetched_at;
  // The "Updated" note says when the newest data on screen was read.
  const reads = [weatherRead, ...fetchedAt.values()].filter((time): time is string => time !== undefined);
  const updatedAt = reads.toSorted((a, b) => Date.parse(b) - Date.parse(a))[0];

  return {
    weather: { views: weather?.views ?? [] },
    hourly:
      weather && updatedAt
        ? {
            hours: weather.hours,
            updatedAt,
            stale: down || snapshot.weatherHeld || olderThan(weatherRead, WEATHER_STALE_MS, now),
            now,
            clockFormat
          }
        : null,
    notices: { notices: toNoticeItems(snapshot, now, clockFormat) },
    tube: boards.tube && {
      stopName: boards.tube.stopName,
      departures: boards.tube.departures,
      now,
      stale: boardStale(boards.tube.stopIds)
    },
    bus: boards.bus && {
      stopName: boards.bus.stopName,
      departures: boards.bus.departures,
      now,
      stale: boardStale(boards.bus.stopIds)
    }
  };
}
