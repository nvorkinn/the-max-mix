// cspell:ignore GZZLUEAC helligdager
// The Dashboard's notice board, from countdown-server: GET /api/devices/notices (countdown-api's getNotices), with the
// device secret. The server hands over what its providers stored for the device (TfL's line statuses and station
// disruptions at its stops and its road disruptions, the Met Office's and the Environment Agency's warnings for a UK
// postcode, GOV.UK's bank holidays, MET Norway's warnings for a Norwegian one) as the providers had it, and the kiosk
// makes the notices from it here, as the e-paper renderer does when it draws: a headline and one short line each, with
// the provider's own text kept for a tap, so the times are said as of now and in the kiosk's clock format. Norway's
// public holidays and the clocks changing need no data: they are worked out here. Which of it is worth a notice, how
// much each matters, and the words (messages.ts), are the e-paper screens' too. A build that sets
// VITE_COUNTDOWN_CONFIG=mock gets made-up notices instead.

import type { BankHoliday, DeviceNotices, FloodWarning, MetOfficeFeedItem, NoticeShort } from 'countdown-api';
import { getNotices as getNoticesRoute } from '../../vendor/countdown-api/src/countdown_api/client';
import type { Client } from '../../vendor/countdown-api/src/countdown_api/client';
import { serverClient } from '../countdown/config';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';
import type { ClockFormat } from '../utils/clockFormat';
import { formatClockTime } from '../utils/clockFormat';
import type { Notice } from './data';
import { say } from './messages';
import { parcelNotices } from './parcels';

type Severity = Notice['severity'];

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
/** A bank holiday is mentioned this far ahead, as on the e-paper screens. */
const HOLIDAY_AHEAD_DAYS = 31;
/** Worst first. */
const SEVERITY_ORDER: readonly Severity[] = ['severe', 'minor', 'info', 'planned', 'everyday'];

/** The device's notice sources, as countdown-server gives them; null when it isn't registered or can't be asked. */
export async function getDeviceNotices(client: Client | null = serverClient()): Promise<DeviceNotices | null> {
  if (!client) return null;
  try {
    const { data, response } = await getNoticesRoute(client);
    if (!data) debugLog('warn', 'dashboard', `Could not read the notices: ${response.status}`);
    return data ?? null;
  } catch (caught) {
    debugLog('warn', 'dashboard', `Could not read the notices: ${errorMessage(caught)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Saying when.

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (time: Date) => `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`;
const sameDay = (a: Date, b: Date) => localDay(a) === localDay(b);

function dayName(day: Date, now: Date): string {
  if (sameDay(day, now)) return say('notice.day.today');
  if (sameDay(day, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))) return say('notice.day.tomorrow');
  return day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
}

/** A day within the week as its weekday ("Sat"), further off as its date ("4 Oct"). */
function shortDay(day: Date, now: Date): string {
  const days = (day.getTime() - now.getTime()) / DAY;
  return day.toLocaleDateString('en-GB', days < 6 ? { weekday: 'short' } : { day: 'numeric', month: 'short' });
}

// A closure that ends in the small hours (TfL's often end at 04:30 Monday) is the day before's, for saying its days.
const lastDay = (end: Date) => (end.getHours() < 5 ? new Date(end.getTime() - 5 * HOUR) : end);

/** When something applies, as short as it can be said: "18:00–21:00", "until 21:00", "Sat–Sun", "until 4 Oct". */
export function sayWhen(starts: Date | null, ends: Date | null, now: Date, clockFormat: ClockFormat): string | null {
  if (!ends) return null;
  // A time today on its own ("21:00"), on another day with its day ("Sat 09:00").
  const time = (t: Date) => {
    const clock = formatClockTime(t, clockFormat);
    return sameDay(t, now) ? clock : `${shortDay(t, now)} ${clock}`;
  };
  if (!starts || starts <= now) {
    const when = ends.getTime() - now.getTime() < DAY ? time(ends) : shortDay(lastDay(ends), now);
    return say('notice.until', { when });
  }
  if (ends.getTime() - starts.getTime() < DAY) return `${time(starts)}–${formatClockTime(ends, clockFormat)}`;
  const first = shortDay(starts, now);
  const last = shortDay(lastDay(ends), now);
  return first === last ? first : `${first}–${last}`;
}

const squash = (text: string | null | undefined) => (text ?? '').split(/\s/).filter(Boolean).join(' ');
const joined = (...parts: (string | null)[]) => parts.filter(Boolean).join(' ');

// Words a sentence can't end on, so "St. Paul's" isn't taken for the end of one.
const ABBREVIATIONS = new Set(['st', 'rd', 'ave', 'mt', 'no']);

/** The first sentence of a provider's text, without the "NORTHERN LINE:" or "WATERLOO ROAD, Southwark:" before it. */
function headline(text: string): string {
  const colon = text.indexOf(': ');
  let rest = colon > 0 && colon < 60 ? text.slice(colon + 2) : text;
  rest = rest.charAt(0).toUpperCase() + rest.slice(1);
  for (let end = rest.indexOf('. '); end !== -1; end = rest.indexOf('. ', end + 1)) {
    const lastWord = rest.slice(0, end).split(' ').at(-1)?.toLowerCase() ?? '';
    if (!ABBREVIATIONS.has(lastWord)) return rest.slice(0, end + 1);
  }
  return rest;
}

// ---------------------------------------------------------------------------------------------------------------------
// TfL's line statuses (v1:notices:tfl-lines:<stop id>), in TfL's /Line/{ids}/Status shape, which the contract leaves
// open: the parts read here.

interface TflValidityPeriod {
  fromDate: string;
  toDate: string;
}

interface TflLine {
  id: string;
  name: string;
  modeName?: string;
  lineStatuses?: { statusSeverityDescription: string; reason?: string | null; validityPeriods?: TflValidityPeriod[] }[];
}

// TfL's statuses worth a notice (/Line/Meta/Severity lists them all, the same for every mode), as on the e-paper
// screens (countdown's renderer, notices/tfl.py): how bad each is, and its key in the catalog's notice.line.status.
// Suspended is the worst (red); a part suspension and severe delays are a disruption (amber); issues are only said.
// Closures are planned works whenever they are in force.
const LINE_STATUSES = new Map<string, readonly [Severity, string]>([
  ['Suspended', ['severe', 'suspended']],
  ['Part Suspended', ['minor', 'part_suspended']],
  ['Severe Delays', ['minor', 'severe_delays']],
  ['Issues Reported', ['info', 'issues']],
  ['Part Closure', ['planned', 'part_closed']],
  ['Planned Closure', ['planned', 'closed']],
  ['Closed', ['planned', 'closed']],
  ['Not Running', ['planned', 'not_running']]
]);
// Everything else isn't: minor delays, a reduced service, bus diversions ("Special Service"), Service Closed (after the
// last train), Good Service.

/**
 * The period a status applies in at `now`: undefined for a status with no periods, which applies; null for one whose
 * periods are all over or still to come (a closure later this week), which doesn't.
 */
function periodInForce(periods: TflValidityPeriod[], now: Date): TflValidityPeriod | null | undefined {
  if (periods.length === 0) return undefined;
  const time = now.getTime();
  return periods.find(p => Date.parse(p.fromDate) <= time && time <= Date.parse(p.toDate)) ?? null;
}

// TfL's period for a disruption is usually just "today", which says nothing: its end is said only for one that runs
// for days.
function periodWhen(period: TflValidityPeriod | undefined, now: Date, clockFormat: ClockFormat): string | null {
  if (!period) return null;
  const from = new Date(period.fromDate);
  const to = new Date(period.toDate);
  return to.getTime() - from.getTime() >= DAY ? sayWhen(null, to, now, clockFormat) : null;
}

interface LineEntry {
  notice: Notice;
  mode: string;
  lines: string[];
  /** The status's key in notice.line.status. */
  status: string;
}

/** A line's notice's title: "Northern line: Severe delays", "Bus 333: Suspended", "Buses 333, 415: Part suspended". */
function lineTitle({ mode, lines, status }: LineEntry): string {
  return say('notice.line.title', {
    label: say('notice.line.label', { mode, count: lines.length, lines: lines.join(', ') }),
    status: say('notice.line.status', { status })
  });
}

/**
 * The notices for the statuses of `lines` that are worth one and apply at `now`. A reason a model has shortened
 * (`shorts`, stored beside the statuses) is said in its short form; any other by its first sentence.
 */
export function lineNotices(
  lines: readonly TflLine[],
  now: Date,
  clockFormat: ClockFormat,
  shorts: readonly NoticeShort[] = []
): Notice[] {
  const shortOf = new Map(shorts.map(short => [short.text, short.summary]));
  const entries: LineEntry[] = [];
  // TfL repeats a bus closure word for word on every route it affects, which is one notice.
  const byReason = new Map<string, LineEntry>();
  for (const line of lines) {
    const mode = line.modeName ?? '';
    const name = mode === 'bus' ? line.name : line.name.replace(/ line$/i, '');
    const statuses = line.lineStatuses ?? [];
    for (const status of statuses) {
      const description = status.statusSeverityDescription;
      const known = LINE_STATUSES.get(description);
      if (!known) continue;
      const period = periodInForce(status.validityPeriods ?? [], now);
      if (period === null) continue;
      const [severity, key] = known;
      const reason = squash(status.reason);
      const seen = reason ? byReason.get(`${mode}:${reason}`) : undefined;
      if (seen) {
        if (!seen.lines.includes(name)) seen.lines.push(name);
        // The worse of the two counts, and names the notice.
        if (SEVERITY_ORDER.indexOf(severity) < SEVERITY_ORDER.indexOf(seen.notice.severity)) {
          seen.notice.severity = severity;
          seen.status = key;
        }
        continue;
      }
      const entry: LineEntry = {
        mode,
        lines: [name],
        status: key,
        notice: {
          id: `tfl:${line.id}:${description}`,
          kind: severity === 'planned' ? 'closure' : 'delays',
          severity,
          title: '',
          summary: reason
            ? (shortOf.get(reason) ?? headline(reason))
            : joined(say('notice.line.status', { status: key }), periodWhen(period, now, clockFormat)),
          detail: reason || description
        }
      };
      if (reason) byReason.set(`${mode}:${reason}`, entry);
      entries.push(entry);
    }
  }
  return entries.map(entry => ({ ...entry.notice, title: lineTitle(entry) }));
}

// ---------------------------------------------------------------------------------------------------------------------
// The Met Office's warnings feed for the postcode's region (v1:notices:met-office:<postcode>).

const WARNING_TITLE = /^(red|amber|yellow) warning of (.+?) affecting/i;
const WARNING_VALIDITY = /valid from (\d{2})(\d{2}) \w{3} (\d{1,2}) (\w{3}) to (\d{2})(\d{2}) \w{3} (\d{1,2}) (\w{3})/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// A clock in each time zone asked about, made once: making one is slow.
const zoneClocks = new Map<string, Intl.DateTimeFormat>();

/** The wall clock in `timeZone` at `time`: its year, month (1–12), day, hour and minute. */
function wallClock(time: number, timeZone: string) {
  let clock = zoneClocks.get(timeZone);
  if (!clock) {
    clock = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric'
    });
    zoneClocks.set(timeZone, clock);
  }
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of clock.formatToParts(new Date(time))) parts[part.type] = Number(part.value);
  const { year = 0, month = 1, day = 1, hour = 0, minute = 0 } = parts;
  return { year, month, day, hour, minute };
}

/** How far `timeZone` is ahead of UTC at `time`, in milliseconds. */
function zoneOffset(time: number, timeZone: string): number {
  const { year, month, day, hour, minute } = wallClock(time, timeZone);
  return Date.UTC(year, month - 1, day, hour, minute) - Math.floor(time / 60_000) * 60_000;
}

/** How far Europe/London is ahead of UTC at `time`, in milliseconds. */
const londonOffset = (time: number) => zoneOffset(time, 'Europe/London');

/** A UK wall-clock time with no year (the feed leaves it out), as an instant: the year that puts it nearest `now`. */
function ukTime(hour: string, minute: string, day: string, month: string, now: Date): Date | null {
  const monthIndex = MONTHS.indexOf(month.toLowerCase());
  if (monthIndex === -1) return null;
  const instant = (year: number) => {
    const wall = Date.UTC(year, monthIndex, Number(day), Number(hour), Number(minute));
    return wall - londonOffset(wall - londonOffset(wall));
  };
  const year = now.getUTCFullYear();
  let nearest = instant(year);
  for (const candidate of [instant(year - 1), instant(year + 1)]) {
    if (Math.abs(candidate - now.getTime()) < Math.abs(nearest - now.getTime())) nearest = candidate;
  }
  return new Date(nearest);
}

/** The notices for the Met Office's warnings that haven't ended at `now`. */
function weatherNotices(items: readonly MetOfficeFeedItem[], now: Date, clockFormat: ClockFormat): Notice[] {
  const notices: Notice[] = [];
  for (const [index, item] of items.entries()) {
    const title = squash(item.title);
    const description = squash(item.description);
    const match = WARNING_TITLE.exec(title);
    if (!match) continue;
    const [, colour = '', hazard = ''] = match;
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
    const level = colour.toLowerCase();
    const warning = say('notice.weather.warning', { colour: level, hazard: hazard.toLowerCase() });
    notices.push({
      id: `met-office:${index}:${level}:${hazard.toLowerCase()}`,
      kind: 'weather',
      severity: level === 'yellow' ? 'minor' : 'severe',
      title: say('notice.weather.title'),
      summary: joined(warning, sayWhen(starts, ends, now, clockFormat)),
      detail: description || title
    });
  }
  return notices;
}

// ---------------------------------------------------------------------------------------------------------------------
// What's wrong at the TfL stops themselves (v1:notices:tfl-stations:<stop id>): lifts out of order, closed entrances,
// in TfL's /StopPoint/{ids}/Disruption shape, which the contract leaves open: the parts read here.

interface TflDisruptedPoint {
  commonName?: string;
  description?: string;
  toDate?: string | null;
}

/** "Kennington" for "Kennington Underground Station", as on the e-paper screens. */
const shortStationName = (name: string) => name.replace(/ (Underground|Rail|DLR)? ?Station$/, '').trim();

/** A provider's text in the short form a model made of it, matched with its whitespace squashed. */
function shortsOf(shorts: readonly NoticeShort[]): Map<string, string> {
  return new Map(shorts.map(short => [squash(short.text), short.summary]));
}

/**
 * The notices for what TfL says is wrong at the stops (`points`), leaving out what's over by `now`, each once: TfL often
 * lists the same one more than once, for different dates. Never more than info, as on the e-paper screens.
 */
export function stationNotices(points: readonly TflDisruptedPoint[], now: Date, shorts: readonly NoticeShort[] = []) {
  const shortOf = shortsOf(shorts);
  const notices: Notice[] = [];
  const seen = new Set<string>();
  for (const point of points) {
    if (point.toDate && Date.parse(point.toDate) < now.getTime()) continue;
    // TfL leads with the station's name in capitals ("KENNINGTON UNDERGROUND STATION: ..."), which the title says.
    const description = squash(point.description);
    const colon = description.indexOf(':');
    const text = colon === -1 ? description : description.slice(colon + 1).trim();
    const station = shortStationName(squash(point.commonName));
    if (!text || seen.has(`${station}:${text}`)) continue;
    seen.add(`${station}:${text}`);
    notices.push({
      id: `station:${station}:${text}`,
      kind: 'delays',
      severity: 'info',
      title: say('notice.station.title', { station }),
      summary: shortOf.get(description) ?? headline(text),
      detail: description
    });
  }
  return notices;
}

// ---------------------------------------------------------------------------------------------------------------------
// TfL's road disruptions near the postcode (v1:notices:tfl-roads:<place>), in TfL's /Road/all/Disruption shape, which
// the contract leaves open: the parts read here.

interface TflRoadDisruption {
  id: string;
  severity?: string;
  category?: string;
  comments?: string;
  endDateTime?: string | null;
}

// TfL's road severities worth a notice (/Road/Meta/Severities has them all), as on the e-paper screens.
const ROAD_SEVERITY = new Map<string, Severity>([
  ['Severe', 'minor'],
  ['Serious', 'info']
]);

/** "[A3] Kennington Park Road (SE11) (Lambeth) - Northbound closed" as "[A3] Kennington Park Road – Northbound closed". */
function roadComments(comments: string): string {
  const dash = comments.indexOf(' - ');
  if (dash === -1) return comments;
  const road = comments.slice(0, dash).replaceAll(/\s*\([^)]*\)/g, '');
  return `${road.trim()} – ${comments.slice(dash + 3).trim()}`;
}

/** The notices for the severe and serious road disruptions among `disruptions` (the nearby ones), while they last. */
export function roadNotices(
  disruptions: readonly TflRoadDisruption[],
  now: Date,
  shorts: readonly NoticeShort[] = []
): Notice[] {
  const shortOf = shortsOf(shorts);
  const notices: Notice[] = [];
  for (const disruption of disruptions) {
    const severity = ROAD_SEVERITY.get(disruption.severity ?? '');
    if (!severity) continue;
    if (disruption.endDateTime && Date.parse(disruption.endDateTime) < now.getTime()) continue;
    const comments = squash(disruption.comments);
    notices.push({
      id: `road:${disruption.id}`,
      kind: 'road',
      severity,
      title: say('notice.road.title'),
      summary:
        shortOf.get(comments) ??
        say('notice.road.text', { category: squash(disruption.category), comments: roadComments(comments) }),
      detail: comments
    });
  }
  return notices;
}

// ---------------------------------------------------------------------------------------------------------------------
// The Environment Agency's flood warnings near the postcode (v1:notices:floods:<place>).

// Its severityLevel: 1 a severe flood warning, 2 a flood warning, 3 a flood alert; 4, no longer in force, isn't worth one.
const FLOOD_LEVELS = new Map<number, readonly [Severity, string]>([
  [1, ['severe', 'severe']],
  [2, ['minor', 'warning']],
  [3, ['info', 'alert']]
]);

/** The notices for the EA's warnings still in force, in its order. */
export function floodNotices(warnings: readonly FloodWarning[]): Notice[] {
  const notices: Notice[] = [];
  for (const warning of warnings) {
    const known = FLOOD_LEVELS.get(warning.severityLevel);
    if (!known) continue;
    const [severity, level] = known;
    const where = squash(warning.description);
    notices.push({
      id: `flood:${warning.floodAreaID}:${String(warning.severityLevel)}`,
      kind: 'weather',
      severity,
      title: say('notice.flood.title', { level }),
      summary: where,
      detail: where
    });
  }
  return notices;
}

// ---------------------------------------------------------------------------------------------------------------------
// MET Norway's weather warnings (MetAlerts) covering a Norwegian postcode, which the server has already narrowed to the
// place: a GeoJSON FeatureCollection, MET's names in each Feature's properties.

interface MetAlertsFeature {
  properties?: Record<string, unknown> | null;
  when?: { interval?: string[] } | null;
}

const text = (value: unknown) => (typeof value === 'string' ? squash(value) : '');

const METALERTS_SEVERITY = new Map<string, Severity>([
  ['red', 'severe'],
  ['orange', 'severe'],
  ['yellow', 'minor']
]);

/** A warning's level, "yellow", "orange" or "red": its riskMatrixColor, or from its awareness_level ("2; yellow; Moderate"). */
function metAlertsColour(properties: Record<string, unknown>): string | null {
  const colour = text(properties['riskMatrixColor']).toLowerCase();
  if (METALERTS_SEVERITY.has(colour)) return colour;
  const parts = text(properties['awareness_level'])
    .split(';')
    .map(part => part.trim().toLowerCase());
  return parts.find(part => METALERTS_SEVERITY.has(part)) ?? null;
}

/** The notices for MetAlerts' warnings (`answer`, its English one) that haven't ended at `now`. */
export function metAlertsNotices(answer: unknown, now: Date, clockFormat: ClockFormat): Notice[] {
  const features = (answer as { features?: MetAlertsFeature[] | null } | null)?.features ?? [];
  const notices: Notice[] = [];
  for (const [index, feature] of features.entries()) {
    const properties = feature.properties ?? {};
    const colour = metAlertsColour(properties);
    const hazard = (text(properties['eventAwarenessName']) || text(properties['event'])).toLowerCase();
    if (!colour || !hazard) continue;
    const [from, to] = [feature.when?.interval?.[0], feature.when?.interval?.at(-1)];
    const starts = from ? new Date(from) : null;
    const ends = to ? new Date(to) : null;
    if (ends && ends < now) continue;
    const said = ['description', 'consequences', 'instruction'].map(name => text(properties[name])).filter(Boolean);
    notices.push({
      id: `metalerts:${text(properties['id']) || String(index)}`,
      kind: 'weather',
      severity: METALERTS_SEVERITY.get(colour) ?? 'minor',
      title: say('notice.weather.title'),
      summary: joined(say('notice.weather.warning', { colour, hazard }), sayWhen(starts, ends, now, clockFormat)),
      detail: said.length > 0 ? said.join(' ') : text(properties['title'])
    });
  }
  return notices;
}

// ---------------------------------------------------------------------------------------------------------------------
// GOV.UK's bank holidays (v1:notices:bank-holidays), every part of the UK's.

type Division = 'england-and-wales' | 'scotland' | 'northern-ireland';

// Scotland's postcode areas (TD and DG are almost all Scottish too).
const SCOTTISH_AREAS = new Set(['AB', 'DD', 'DG', 'EH', 'FK', 'G', 'HS', 'IV', 'KA', 'KW', 'KY', 'ML', 'PA', 'PH']);
SCOTTISH_AREAS.add('TD').add('ZE');

/** The part of the UK whose bank holidays a UK postcode keeps, from its area. */
export function divisionOf(postcode: string): Division {
  const area = /^[A-Z]{1,2}/.exec(postcode.trim().toUpperCase())?.[0] ?? '';
  if (area === 'BT') return 'northern-ireland';
  return SCOTTISH_AREAS.has(area) ? 'scotland' : 'england-and-wales';
}

/** The next of `events` from today, if it is less than a month away. */
export function holidayNotices(events: readonly BankHoliday[], now: Date): Notice[] {
  const today = localDay(now);
  const limit = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + HOLIDAY_AHEAD_DAYS));
  const next = events
    .filter(event => event.date >= today && event.date < limit)
    .toSorted((a, b) => a.date.localeCompare(b.date))[0];
  if (!next) return [];
  const [year = 0, month = 1, day = 1] = next.date.split('-').map(Number);
  const holiday = new Date(year, month - 1, day);
  const notes = squash(next.notes);
  return [
    {
      id: `holiday:${next.date}`,
      kind: 'holiday',
      severity: 'info',
      title: say('notice.holiday.title'),
      summary: say('notice.holiday.summary', { when: dayName(holiday, now), name: next.title }),
      detail: notes ? `${next.title} (${notes.toLowerCase()})` : next.title
    }
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// Norway's public holidays and the clocks changing, worked out here: they need no data.

/** Easter Sunday, by the anonymous Gregorian algorithm. */
function easter(year: number): Date {
  const [a, b, c] = [year % 19, Math.floor(year / 100), year % 100];
  const [d, e] = [Math.floor(b / 4), b % 4];
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const [i, k] = [Math.floor(c / 4), c % 4];
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Norway's public holidays in `year` (its helligdager and the two statutory days, 1 and 17 May), in date order. */
export function norwegianHolidays(year: number): { day: Date; holiday: string }[] {
  const sunday = easter(year);
  const fromEaster = (days: number) => new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + days);
  const holidays = [
    { day: new Date(year, 0, 1), holiday: 'new_year' },
    { day: fromEaster(-3), holiday: 'maundy_thursday' },
    { day: fromEaster(-2), holiday: 'good_friday' },
    { day: sunday, holiday: 'easter_sunday' },
    { day: fromEaster(1), holiday: 'easter_monday' },
    { day: new Date(year, 4, 1), holiday: 'labour_day' },
    { day: new Date(year, 4, 17), holiday: 'constitution_day' },
    { day: fromEaster(39), holiday: 'ascension_day' },
    { day: fromEaster(49), holiday: 'whit_sunday' },
    { day: fromEaster(50), holiday: 'whit_monday' },
    { day: new Date(year, 11, 25), holiday: 'christmas_day' },
    { day: new Date(year, 11, 26), holiday: 'boxing_day' }
  ];
  return holidays.toSorted((x, y) => x.day.getTime() - y.day.getTime());
}

/** The next Norwegian public holiday from today, if it is less than a month away, as on the e-paper screens. */
export function norwegianHolidayNotices(now: Date): Notice[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + HOLIDAY_AHEAD_DAYS);
  const next = [now.getFullYear(), now.getFullYear() + 1]
    .flatMap(year => norwegianHolidays(year))
    .find(({ day }) => day >= today && day < limit);
  if (!next) return [];
  const name = say('notice.holiday.name', { holiday: next.holiday });
  return [
    {
      id: `holiday:${localDay(next.day)}`,
      kind: 'holiday',
      severity: 'info',
      title: say('notice.holiday.public_title'),
      summary: say('notice.holiday.summary', { when: dayName(next.day, now), name }),
      detail: name
    }
  ];
}

/** How far ahead the clocks changing is mentioned, as on the e-paper screens. */
const CLOCK_CHANGE_AHEAD_HOURS = 7 * 24;

/** The kiosk's own time zone. */
const kioskZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** When the clock in `timeZone` next goes forward or back, within a week of `now`, or null if it doesn't. On the hour. */
export function nextClockChange(now: Date, timeZone = kioskZone()): Date | null {
  let hour = Math.floor(now.getTime() / HOUR) * HOUR;
  const offset = zoneOffset(hour, timeZone);
  for (let step = 0; step <= CLOCK_CHANGE_AHEAD_HOURS; step++) {
    hour += HOUR;
    if (zoneOffset(hour, timeZone) !== offset) return new Date(hour);
  }
  return null;
}

/** The day in `timeZone` at `time`, `days` on, as a date at noon UTC (for saying it in UTC). */
function zoneDate(time: number, timeZone: string, days = 0): Date {
  const { year, month, day } = wallClock(time, timeZone);
  return new Date(Date.UTC(year, month - 1, day + days, 12));
}

/**
 * A reminder in the week before the clock in `timeZone` (the kiosk's) goes forward or back: which way, the night or
 * the day, and the time it changes at on the clock as it is before (01:00 in March, 02:00 in October in London).
 */
export function clockChangeNotices(now: Date, clockFormat: ClockFormat, timeZone = kioskZone()): Notice[] {
  const change = nextClockChange(now, timeZone);
  if (!change) return [];
  const before = zoneOffset(change.getTime() - 1, timeZone);
  const direction = zoneOffset(change.getTime(), timeZone) > before ? 'forward' : 'back';
  // The time on the clock as it is before the change, said as UTC.
  const at = formatClockTime(new Date(change.getTime() + before), clockFormat, 'UTC');
  const day = zoneDate(change.getTime() - 1, timeZone);
  const tonight = [0, 1].some(days => zoneDate(now.getTime(), timeZone, days).getTime() === day.getTime());
  const date = day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const when = tonight ? say('notice.clock.tonight') : say('notice.clock.on', { day: date.replace(',', '') });
  const summary = `${say('notice.clock.text', { direction, when })} ${at}`;
  return [
    {
      id: `clock:${change.toISOString()}`,
      kind: 'holiday',
      severity: 'info',
      title: say('notice.clock.title'),
      summary,
      detail: summary
    }
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// The board.

/**
 * The notice board's notices from what countdown-server gave, as of `now`, worst first, then as the e-paper screens
 * rank them: the lines and the stations before the weather, the floods and the roads, before the clocks changing and the
 * holidays, before the parcels. Only the parcels and the clocks changing while the board has no postcode (an older
 * countdown-server sends none).
 */
export function boardNotices(device: DeviceNotices, now: Date, clockFormat: ClockFormat): Notice[] {
  const parcels = parcelNotices(device.parcels?.parcels ?? [], now);
  const clocks = clockChangeNotices(now, clockFormat);
  if (!device.postcode) return byUrgency(device.parcels ? [...clocks, ...parcels] : []);
  const lines: TflLine[] = [];
  const shorts: NoticeShort[] = [];
  const seen = new Set<string>();
  const points: TflDisruptedPoint[] = [];
  const pointShorts: NoticeShort[] = [];
  for (const stop of device.tfl_stops) {
    // TfL's own answer, which the contract leaves open.
    const stopLines = (stop.lines?.lines ?? []) as unknown as TflLine[];
    // An older countdown-server, or a provider with no model, leaves the short forms out.
    shorts.push(...((stop.lines as { shorts?: NoticeShort[] } | null | undefined)?.shorts ?? []));
    for (const line of stopLines) {
      if (seen.has(line.id)) continue;
      seen.add(line.id);
      lines.push(line);
    }
    points.push(...((stop.stations?.disruptions ?? []) as unknown as TflDisruptedPoint[]));
    pointShorts.push(...(stop.stations?.shorts ?? []));
  }
  const roads = (device.tfl_roads?.disruptions ?? []) as unknown as TflRoadDisruption[];
  const norwegian = device.country === 'NO';
  const events = device.bank_holidays?.divisions[divisionOf(device.postcode)]?.events ?? [];
  const notices = [
    ...lineNotices(lines, now, clockFormat, shorts),
    ...stationNotices(points, now, pointShorts),
    ...weatherNotices(device.met_office?.items ?? [], now, clockFormat),
    // An older countdown-server leaves the floods and MetAlerts out.
    ...floodNotices(device.floods?.floods.items ?? []),
    ...roadNotices(roads, now, device.tfl_roads?.shorts ?? []),
    ...metAlertsNotices(device.metalerts?.en ?? null, now, clockFormat),
    ...clocks,
    ...(device.country === 'GB' ? holidayNotices(events, now) : []),
    ...(norwegian ? norwegianHolidayNotices(now) : []),
    ...parcels
  ];
  return byUrgency(notices);
}

/** `notices` worst first, keeping their order among equals. */
function byUrgency(notices: Notice[]): Notice[] {
  return notices
    .map((notice, index) => ({ notice, index }))
    .toSorted(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.notice.severity) - SEVERITY_ORDER.indexOf(b.notice.severity) || a.index - b.index
    )
    .map(({ notice }) => notice);
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading them.

/** Made-up notice sources for a build that mocks countdown-server, timed from now. */
export function mockDeviceNotices(now: Date): DeviceNotices {
  const at = (hours: number) => new Date(now.getTime() + hours * HOUR).toISOString();
  const delays =
    'NORTHERN LINE: Severe delays between Morden and Kennington while we fix a signal failure at Clapham Common. ' +
    'GOOD SERVICE on the rest of the line.';
  const lines = [
    {
      id: 'northern',
      name: 'Northern',
      modeName: 'tube',
      lineStatuses: [{ statusSeverityDescription: 'Severe Delays', reason: delays }]
    },
    {
      id: 'victoria',
      name: 'Victoria',
      modeName: 'tube',
      lineStatuses: [
        {
          statusSeverityDescription: 'Part Closure',
          reason:
            'VICTORIA LINE: No service between Euston and Walthamstow Central while we carry out track renewal ' +
            'works. Replacement buses operate.',
          validityPeriods: [{ fromDate: at(-24), toDate: at(48) }]
        }
      ]
    }
  ];
  // The Northern line's reason as a model shortened it; the Victoria line's hasn't been, so its first sentence is said.
  const shorts = [
    {
      text: delays,
      title: 'Delays, Morden to Kennington',
      summary: 'Morden to Kennington, signal failure at Clapham Common'
    }
  ];
  return {
    postcode: 'SE17 3LL',
    country: 'GB',
    tfl_stops: [
      {
        stop_id: '940GZZLUEAC',
        lines: { fetched_at: now.toISOString(), stop_id: '940GZZLUEAC', lines: lines as never[], shorts },
        stations: null
      }
    ],
    tfl_roads: null,
    met_office: {
      fetched_at: now.toISOString(),
      postcode: 'SE17 3LL',
      region: 'se',
      items: [
        {
          title: 'Yellow warning of rain affecting London & South East England',
          description: 'Heavy and persistent rain may lead to some flooding and travel disruption.',
          link: '',
          pub_date: ''
        }
      ]
    },
    bank_holidays: null,
    floods: null,
    metalerts: null,
    // The notice board has notices, so the Tube status panel doesn't show.
    tfl_network: null,
    entur_stops: [],
    parcels: {
      fetched_at: now.toISOString(),
      parcels: [
        {
          description: 'Running shoes',
          carrier: 'DHL',
          tracking_number: 'JD0000000000000001',
          status: 'out_for_delivery',
          expected_date: null,
          updated_at: at(-2)
        }
      ]
    }
  };
}

let lastAnswer: DeviceNotices | null = null;

/**
 * The notice board's notices as of `now`, from countdown-server's latest answer (the one before it while the server
 * can't be reached), or none before it has given one.
 */
export async function readNotices(
  now: Date,
  clockFormat: ClockFormat,
  client: Client | null = serverClient()
): Promise<Notice[]> {
  if (import.meta.env.VITE_COUNTDOWN_CONFIG === 'mock') return boardNotices(mockDeviceNotices(now), now, clockFormat);
  const answer = await getDeviceNotices(client);
  if (answer) lastAnswer = answer;
  return lastAnswer ? boardNotices(lastAnswer, now, clockFormat) : [];
}

/** Forgets the last answer (for tests). */
export function forgetNotices(): void {
  lastAnswer = null;
}
