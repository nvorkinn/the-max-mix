// The Dashboard's notice board: short, structured notices (what it is about, how bad, two or three words and when)
// made from the providers' own answers, so the board can draw a notice instead of printing the provider's prose. The
// provider's words stay on each notice (`title`, `detail`) for when one is tapped.
//
// The answers are the ones countdown's providers keep in the store for the e-paper screens (TfL's line statuses, the
// Met Office's warnings feed, GOV.UK's bank holidays), in the same shapes, so the same mapping serves whether the kiosk
// asks the provider itself or countdown-server hands it what it stored. For now the kiosk asks TfL and GOV.UK directly
// (both allow it from a browser); the Met Office's feed can't be read from a browser, so it waits for countdown-server.

import type { TouchscreenConfig } from 'countdown-api';
import type { ClockFormat } from '../utils/clockFormat';
import { formatClockTime } from '../utils/clockFormat';

/** How bad a notice is, worst first: what colour the board gives it. */
type NoticeSeverity = 'severe' | 'warning' | 'minor' | 'info';

/** What a weather warning is for, so the board can draw it. */
type Hazard = 'rain' | 'wind' | 'snow' | 'ice' | 'thunderstorm' | 'fog' | 'heat' | 'other';

interface NoticeBase {
  id: string;
  severity: NoticeSeverity;
  /** Two or three words: "Severe delays", "Diverted", "Rain", "Christmas Day". */
  status: string;
  /** When it starts, as an ISO time, if that is worth saying. */
  starts?: string;
  /** When it ends, as an ISO time, if that is worth saying. */
  ends?: string;
  /** The provider's headline. */
  title: string;
  /** The provider's full text. */
  detail: string;
}

/** Trouble on Tube, rail or bus lines serving the Dashboard's stops. */
export interface LineNotice extends NoticeBase {
  kind: 'line';
  /** TfL's mode: tube, bus, dlr, overground, elizabeth-line, tram. */
  mode: string;
  /** The lines or routes it is about, short ("Northern", "Elizabeth", "333"): one notice for a reason TfL gives for several. */
  lines: string[];
}

/** A Met Office weather warning for the notice board's place. */
export interface WeatherNotice extends NoticeBase {
  kind: 'weather';
  hazard: Hazard;
  /** The Met Office's colour for it. */
  level: 'yellow' | 'amber' | 'red';
}

/** A bank holiday coming up. */
export interface HolidayNotice extends NoticeBase {
  kind: 'holiday';
  /** The day, as YYYY-MM-DD. */
  day: string;
}

export type Notice = LineNotice | WeatherNotice | HolidayNotice;

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
/** A planned closure is mentioned this far ahead. */
const PLANNED_AHEAD_MS = 7 * DAY;
/** A bank holiday is mentioned this far ahead, as on the e-paper screens. */
const HOLIDAY_AHEAD_DAYS = 31;

// ---------------------------------------------------------------------------------------------------------------------
// TfL: /Line/{ids}/Status, as the TfL notices provider stores it (v1:notices:tfl-lines:<stop id>).

interface TflValidityPeriod {
  fromDate: string;
  toDate: string;
}

interface TflLineStatus {
  statusSeverityDescription: string;
  reason?: string | null;
  validityPeriods?: TflValidityPeriod[];
}

/** One line in TfL's /Line/{ids}/Status answer, the parts read here. */
export interface TflLine {
  id: string;
  name: string;
  modeName: string;
  lineStatuses: TflLineStatus[];
}

// TfL's statuses worth a notice (/Line/Meta/Severity lists them all, the same for every mode), with how bad each is and
// what the board says. Good Service, Service Closed (after the last train) and the like aren't.
const LINE_STATUSES = new Map<string, readonly [NoticeSeverity, string]>([
  ['Suspended', ['severe', 'Suspended']],
  ['Closed', ['severe', 'Closed']],
  ['Planned Closure', ['severe', 'Closed']],
  ['Not Running', ['severe', 'Not running']],
  ['Part Suspended', ['warning', 'Part suspended']],
  ['Part Closure', ['warning', 'Part closed']],
  ['Severe Delays', ['warning', 'Severe delays']],
  ['Minor Delays', ['minor', 'Delays']],
  ['Reduced Service', ['minor', 'Reduced service']],
  ['Issues Reported', ['minor', 'Issues']],
  // A bus diversion, when the reason says so (below); otherwise nothing worth a notice.
  ['Special Service', ['minor', 'Diverted']]
]);

const SEVERITY_ORDER: readonly NoticeSeverity[] = ['severe', 'warning', 'minor', 'info'];
const worse = (a: NoticeSeverity, b: NoticeSeverity) =>
  SEVERITY_ORDER.indexOf(a) <= SEVERITY_ORDER.indexOf(b) ? a : b;

const squash = (text: string | null | undefined) => (text ?? '').split(/\s/).filter(Boolean).join(' ');
const shortLineName = (name: string) => (name.toLowerCase().endsWith(' line') ? name.slice(0, -5) : name);
const isDiversion = (reason: string) => /\bdivert(ed|ion)/i.test(reason);

/** The period a status applies in that is worth showing at `now`: the current one, or a planned one soon. */
function periodToShow(periods: TflValidityPeriod[], now: Date): TflValidityPeriod | null | undefined {
  if (periods.length === 0) return undefined;
  const time = now.getTime();
  const current = periods.find(p => Date.parse(p.fromDate) <= time && time <= Date.parse(p.toDate));
  if (current) return current;
  const soon = periods
    .filter(p => Date.parse(p.fromDate) > time && Date.parse(p.fromDate) - time <= PLANNED_AHEAD_MS)
    .toSorted((a, b) => Date.parse(a.fromDate) - Date.parse(b.fromDate));
  return soon[0] ?? null;
}

/** The notices for the statuses of `lines` that matter at `now`. */
export function lineNotices(lines: readonly TflLine[], now: Date): LineNotice[] {
  // Keyed by reason: TfL repeats a bus closure word for word on every route it affects, which is one notice.
  const notices: LineNotice[] = [];
  const byReason = new Map<string, LineNotice>();
  for (const line of lines) {
    const mode = line.modeName;
    const name = mode === 'bus' ? line.name : shortLineName(line.name);
    for (const status of line.lineStatuses) {
      const known = LINE_STATUSES.get(status.statusSeverityDescription);
      if (!known) continue;
      const reason = squash(status.reason);
      const diverted = mode === 'bus' && isDiversion(reason);
      if (!diverted && status.statusSeverityDescription === 'Special Service') continue;
      const period = periodToShow(status.validityPeriods ?? [], now);
      if (period === null) continue;
      const [severity, label] = known;
      const notice: LineNotice = {
        id: `${line.id}:${status.statusSeverityDescription}`,
        kind: 'line',
        mode,
        lines: [name],
        severity,
        status: diverted ? 'Diverted' : label,
        title: `${name}: ${status.statusSeverityDescription}`,
        detail: reason || status.statusSeverityDescription,
        ...periodTimes(period, now)
      };
      const key = reason ? `${mode}:${reason}` : notice.id;
      const seen = byReason.get(key);
      if (seen) {
        if (!seen.lines.includes(name)) seen.lines.push(name);
        seen.severity = worse(seen.severity, severity);
      } else {
        byReason.set(key, notice);
        notices.push(notice);
      }
    }
  }
  return notices;
}

// When a disruption is happening now, TfL's period is usually just "today", which says nothing: the times are kept only
// for one that hasn't started, or that runs for days.
function periodTimes(period: TflValidityPeriod | undefined, now: Date): Pick<NoticeBase, 'starts' | 'ends'> {
  if (!period) return {};
  const from = Date.parse(period.fromDate);
  const to = Date.parse(period.toDate);
  if (from > now.getTime()) return { starts: period.fromDate, ends: period.toDate };
  if (to - from >= DAY) return { ends: period.toDate };
  return {};
}

// ---------------------------------------------------------------------------------------------------------------------
// The Met Office: its region's warnings RSS, as provider-met-office stores it (v1:notices:met-office:<postcode>).

/** One <item> of the Met Office's warnings feed. */
export interface MetOfficeItem {
  /** "Amber warning of wind affecting London & South East England" */
  title: string;
  /** "...: Lambeth, Southwark valid from 0600 Fri 25 Sep to 2100 Fri 25 Sep" */
  description: string;
}

const WARNING_TITLE = /^(red|amber|yellow) warning of (.+?) affecting/i;
const WARNING_VALIDITY = /valid from (\d{2})(\d{2}) \w{3} (\d{1,2}) (\w{3}) to (\d{2})(\d{2}) \w{3} (\d{1,2}) (\w{3})/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WARNING_SEVERITY = { red: 'severe', amber: 'warning', yellow: 'minor' } as const;

function hazardOf(text: string): Hazard {
  if (/thunder|lightning/.test(text)) return 'thunderstorm';
  if (text.includes('snow')) return 'snow';
  if (text.includes('ice')) return 'ice';
  if (text.includes('rain')) return 'rain';
  if (text.includes('wind')) return 'wind';
  if (text.includes('fog')) return 'fog';
  if (text.includes('heat')) return 'heat';
  return 'other';
}

const LONDON_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric'
});

/** How far Europe/London is ahead of UTC at `time`, in milliseconds. */
function londonOffset(time: number): number {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  const clock = LONDON_CLOCK.formatToParts(new Date(time));
  for (const part of clock) parts[part.type] = Number(part.value);
  const { year = 0, month = 1, day = 1, hour = 0, minute = 0 } = parts;
  const local = Date.UTC(year, month - 1, day, hour, minute);
  return local - Math.floor(time / 60_000) * 60_000;
}

/** A UK wall-clock time with no year (the feed leaves it out), as an instant: the year that puts it nearest `now`. */
function ukTime(hour: string, minute: string, day: string, month: string, now: Date): Date | null {
  const monthIndex = MONTHS.indexOf(month.toLowerCase());
  if (monthIndex === -1) return null;
  const year = now.getUTCFullYear();
  const instant = (y: number) => {
    const wall = Date.UTC(y, monthIndex, Number(day), Number(hour), Number(minute));
    return wall - londonOffset(wall - londonOffset(wall));
  };
  let nearest = instant(year);
  for (const candidate of [instant(year - 1), instant(year + 1)]) {
    if (Math.abs(candidate - now.getTime()) < Math.abs(nearest - now.getTime())) nearest = candidate;
  }
  return new Date(nearest);
}

/** The notices for the Met Office's warnings `items` that haven't ended at `now`. */
export function weatherNotices(items: readonly MetOfficeItem[], now: Date): WeatherNotice[] {
  const notices: WeatherNotice[] = [];
  for (const [index, item] of items.entries()) {
    const title = squash(item.title);
    const description = squash(item.description);
    const match = WARNING_TITLE.exec(title);
    if (!match) continue;
    const [, colour = '', hazardWords = ''] = match;
    const level = colour.toLowerCase() as WeatherNotice['level'];
    const hazardText = hazardWords.toLowerCase();
    const [
      ,
      fromHour = '',
      fromMinute = '',
      fromDay = '',
      fromMonth = '',
      toHour = '',
      toMinute = '',
      toDay = '',
      toMonth = ''
    ] = WARNING_VALIDITY.exec(description) ?? [];
    const starts = ukTime(fromHour, fromMinute, fromDay, fromMonth, now);
    const ends = ukTime(toHour, toMinute, toDay, toMonth, now);
    if (ends && ends < now) continue;
    notices.push({
      id: `weather:${index}:${level}:${hazardText}`,
      kind: 'weather',
      hazard: hazardOf(hazardText),
      level,
      severity: WARNING_SEVERITY[level],
      status: hazardText.charAt(0).toUpperCase() + hazardText.slice(1),
      ...(starts && starts > now && { starts: starts.toISOString() }),
      ...(ends && { ends: ends.toISOString() }),
      title,
      detail: description
    });
  }
  return notices;
}

// ---------------------------------------------------------------------------------------------------------------------
// GOV.UK's bank holidays (https://www.gov.uk/bank-holidays.json), as the bank holidays provider stores it.

/** One of GOV.UK's bank holidays. */
export interface BankHoliday {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** e.g. "Substitute day" */
  notes?: string;
}

export type Division = 'england-and-wales' | 'scotland' | 'northern-ireland';

// Scotland's postcode areas, all of whose districts are in Scotland (TD and DG are almost all Scottish too).
const SCOTTISH_AREAS = new Set([
  'AB',
  'DD',
  'DG',
  'EH',
  'FK',
  'G',
  'HS',
  'IV',
  'KA',
  'KW',
  'KY',
  'ML',
  'PA',
  'PH',
  'TD',
  'ZE'
]);

/** The part of the UK whose bank holidays a UK postcode keeps, worked out from its area so it is never sent anywhere. */
export function divisionOf(postcode: string): Division {
  const area = /^[A-Z]{1,2}/.exec(postcode.trim().toUpperCase())?.[0] ?? '';
  if (area === 'BT') return 'northern-ireland';
  return SCOTTISH_AREAS.has(area) ? 'scotland' : 'england-and-wales';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A local calendar day as YYYY-MM-DD. */
function localDay(time: Date): string {
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`;
}

/** The next of `events` from today, if it is less than a month away. */
export function holidayNotices(events: readonly BankHoliday[], now: Date): HolidayNotice[] {
  const today = localDay(now);
  const limit = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + HOLIDAY_AHEAD_DAYS));
  const next = events
    .filter(event => event.date >= today && event.date < limit)
    .toSorted((a, b) => a.date.localeCompare(b.date))[0];
  if (!next) return [];
  const notes = squash(next.notes);
  return [
    {
      id: `holiday:${next.date}`,
      kind: 'holiday',
      day: next.date,
      severity: 'info',
      status: next.title,
      title: notes ? `${next.title} (${notes.toLowerCase()})` : next.title,
      detail: notes
    }
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// The board.

const KIND_ORDER: readonly Notice['kind'][] = ['line', 'weather', 'holiday'];

/** Worst first, then lines before weather before holidays, each kind in its provider's order. */
export function sortNotices(notices: readonly Notice[]): Notice[] {
  return notices
    .map((notice, index) => ({ notice, index }))
    .toSorted(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.notice.severity) - SEVERITY_ORDER.indexOf(b.notice.severity) ||
        KIND_ORDER.indexOf(a.notice.kind) - KIND_ORDER.indexOf(b.notice.kind) ||
        a.index - b.index
    )
    .map(({ notice }) => notice);
}

const sameDay = (a: Date, b: Date) => localDay(a) === localDay(b);

function dayName(day: Date, now: Date): string {
  if (sameDay(day, now)) return 'Today';
  if (sameDay(day, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))) return 'Tomorrow';
  return day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
}

/** A day within the week as its weekday ("Sat"), further off as its date ("4 Oct"). */
function shortDay(day: Date, now: Date): string {
  const days = (day.getTime() - now.getTime()) / DAY;
  return day.toLocaleDateString('en-GB', days < 6 ? { weekday: 'short' } : { day: 'numeric', month: 'short' });
}

// A closure that ends in the small hours (TfL's often end at 04:30 Monday) is the day before's, for saying its days.
const lastDay = (end: Date) => (end.getHours() < 5 ? new Date(end.getTime() - 5 * HOUR) : end);

/** When a notice applies, as short as it can be said: "Today", "Thu 25 Dec", "18:00–21:00", "until 21:00", "Sat–Sun". */
export function noticeWhen(notice: Notice, now: Date, clockFormat: ClockFormat): string | undefined {
  if (notice.kind === 'holiday') {
    const [year = 0, month = 1, day = 1] = notice.day.split('-').map(Number);
    return dayName(new Date(year, month - 1, day), now);
  }
  if (!notice.ends) return undefined;
  const ends = new Date(notice.ends);
  const starts = notice.starts ? new Date(notice.starts) : null;
  // A time today on its own ("21:00"), on another day with its day ("Sat 09:00").
  const time = (t: Date) => {
    const clock = formatClockTime(t, clockFormat);
    return sameDay(t, now) ? clock : `${shortDay(t, now)} ${clock}`;
  };
  if (!starts || starts <= now) {
    return ends.getTime() - now.getTime() < DAY ? `until ${time(ends)}` : `until ${shortDay(lastDay(ends), now)}`;
  }
  if (ends.getTime() - starts.getTime() < DAY) return `${time(starts)}–${formatClockTime(ends, clockFormat)}`;
  const first = shortDay(starts, now);
  const last = shortDay(lastDay(ends), now);
  return first === last ? first : `${first}–${last}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Fetching.

const TFL = 'https://api.tfl.gov.uk';
const BANK_HOLIDAYS = 'https://www.gov.uk/bank-holidays.json';

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).host}`);
  return (await response.json()) as T;
}

/** The status of every line serving the TfL stops `stopIds`, each line once, as TfL answers /Line/{ids}/Status. */
/** A stop in TfL's /StopPoint/{ids} answer: one for one id, a list for several. */
interface TflStop {
  lines?: { id: string }[];
}

const ids = (values: readonly string[]) => values.map(value => encodeURIComponent(value)).join(',');

async function fetchTflLines(stopIds: readonly string[]): Promise<TflLine[]> {
  if (stopIds.length === 0) return [];
  const answer = await getJson<TflStop | TflStop[]>(`${TFL}/StopPoint/${ids(stopIds)}`);
  const lineIds = [
    ...new Set((Array.isArray(answer) ? answer : [answer]).flatMap(stop => stop.lines ?? []).map(l => l.id))
  ];
  return lineIds.length === 0 ? [] : getJson<TflLine[]>(`${TFL}/Line/${ids(lineIds)}/Status`);
}

async function fetchBankHolidays(division: Division): Promise<BankHoliday[]> {
  const answer = await getJson<Partial<Record<Division, { events: BankHoliday[] }>>>(BANK_HOLIDAYS);
  return answer[division]?.events ?? [];
}

/**
 * The notice board's notices for `config`, worst first: none while the board is off (no postcode). A provider that
 * can't be reached leaves its notices out rather than the board.
 */
export async function getNotices(config: TouchscreenConfig, now = new Date()): Promise<Notice[]> {
  const { postcode, country } = config.notice_board;
  if (!postcode || country !== 'GB') return [];
  const stopIds = config.arrivals.stops.filter(stop => stop.source === 'tfl').map(stop => stop.id);
  const [lines, holidays] = await Promise.allSettled([fetchTflLines(stopIds), fetchBankHolidays(divisionOf(postcode))]);
  return sortNotices([
    ...(lines.status === 'fulfilled' ? lineNotices(lines.value, now) : []),
    ...(holidays.status === 'fulfilled' ? holidayNotices(holidays.value, now) : [])
  ]);
}
