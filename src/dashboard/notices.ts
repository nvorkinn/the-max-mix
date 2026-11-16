// The Dashboard's notice board, from countdown-server: GET /api/devices/notices, with the device secret. The server
// makes each notice from its providers' answers (TfL, the Met Office, GOV.UK...) as short, structured fields, so the
// board can draw a notice instead of printing the provider's prose; the provider's words stay on it (`title`,
// `detail`) for when one is tapped. The route isn't in countdown-api's contract yet, so its types are here until it is.

import { serverClient } from '../countdown/config';
import type { Client } from '../../vendor/countdown-api/src/countdown_api/client';
import type { ClockFormat } from '../utils/clockFormat';
import { formatClockTime } from '../utils/clockFormat';
import type { Notice as BoardNotice } from './data';

interface NoticeBase {
  /** Stays the same while the notice does, so the board can keep track of one (say, the one open). */
  id: string;
  /** How bad it is, worst first: what colour the board gives it. */
  severity: 'severe' | 'warning' | 'minor' | 'info';
  /** Two or three words: "Severe delays", "Diverted", "Wind", "Christmas Day". */
  status: string;
  /** What or where, in one short line: "Severe delays between Kennington and Morden due to a signal failure." */
  summary: string | null;
  /** When it starts, as an ISO time; null when it has started or that isn't worth saying. */
  starts: string | null;
  /** When it ends, as an ISO time; null when that isn't known or worth saying. */
  ends: string | null;
  /** The provider's headline. */
  title: string;
  /** The provider's full text. */
  detail: string;
}

/** Trouble on Tube, rail or bus lines serving the Dashboard's stops. */
interface LineNotice extends NoticeBase {
  kind: 'line';
  /** TfL's mode: tube, bus, dlr, overground, elizabeth-line, tram. */
  mode: string;
  /** The lines or routes it is about, short ("Northern", "Elizabeth", "333"). */
  lines: string[];
}

/** A weather warning for the notice board's place. */
interface WeatherNotice extends NoticeBase {
  kind: 'weather';
  hazard: 'rain' | 'wind' | 'snow' | 'ice' | 'thunderstorm' | 'fog' | 'heat' | 'other';
  /** The warning's colour. */
  level: 'yellow' | 'amber' | 'red';
}

/** A bank holiday coming up. */
interface HolidayNotice extends NoticeBase {
  kind: 'holiday';
  /** The day, as YYYY-MM-DD. */
  day: string;
}

export type ServerNotice = LineNotice | WeatherNotice | HolidayNotice;

/** countdown-server's answer: the board's notices, worst first, and when it last heard from its providers. */
interface NoticesResponse {
  updated_at: string;
  notices: ServerNotice[];
}

const KINDS = new Set<string>(['line', 'weather', 'holiday']);

/**
 * The notice board's notices, worst first, as countdown-server gives them: none while the board is off, and null when
 * the kiosk isn't registered or the server can't be reached or refuses it. A kind of notice this build doesn't know
 * is left out.
 */
export async function getNotices(client: Client | null = serverClient()): Promise<ServerNotice[] | null> {
  if (!client) return null;
  try {
    const response = await (client.fetch ?? fetch)(new URL('/api/devices/notices', client.baseUrl), {
      headers: { Authorization: `Bearer ${client.secret ?? ''}` }
    });
    if (!response.ok) return null;
    const answer = (await response.json()) as NoticesResponse;
    return answer.notices.filter(notice => KINDS.has(notice.kind));
  } catch {
    return null;
  }
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (time: Date) => `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`;
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
export function noticeWhen(notice: ServerNotice, now: Date, clockFormat: ClockFormat): string | null {
  if (notice.kind === 'holiday') {
    const [year = 0, month = 1, day = 1] = notice.day.split('-').map(Number);
    return dayName(new Date(year, month - 1, day), now);
  }
  if (!notice.ends) return null;
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

const CLOSURES = new Set(['Closed', 'Part closed', 'Not running']);
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A line's name as the board writes it: "Northern line", "Bus 333", "Buses 333, 415". */
function lineLabel(notice: LineNotice): string {
  if (notice.mode === 'bus') return `${notice.lines.length > 1 ? 'Buses' : 'Bus'} ${notice.lines.join(', ')}`;
  const names = notice.lines.join(', ');
  return notice.mode === 'tube' || notice.mode === 'elizabeth-line' ? `${names} line` : names;
}

/**
 * A notice from countdown-server as the notice board shows it: a headline and one short line, with the provider's
 * text for a tap. Something that hasn't started yet is shown as planned.
 */
export function toBoardNotice(notice: ServerNotice, now: Date, clockFormat: ClockFormat): BoardNotice {
  const when = noticeWhen(notice, now, clockFormat);
  const planned = notice.starts !== null && Date.parse(notice.starts) > now.getTime();
  const severity = notice.severity === 'warning' ? 'severe' : notice.severity;
  const base = { id: notice.id, severity: planned ? 'planned' : severity, detail: notice.detail } as const;
  switch (notice.kind) {
    case 'line': {
      return {
        ...base,
        kind: CLOSURES.has(notice.status) ? 'closure' : 'delays',
        title: `${lineLabel(notice)}: ${notice.status}`,
        summary: [notice.summary, when].filter(Boolean).join(' ') || notice.status
      };
    }
    case 'weather': {
      return {
        ...base,
        kind: 'weather',
        title: 'Weather warning',
        summary: [`${capitalised(notice.level)} warning: ${notice.status.toLowerCase()}`, when]
          .filter(Boolean)
          .join(' ')
      };
    }
    case 'holiday': {
      return { ...base, kind: 'holiday', title: 'Upcoming bank holiday', summary: `${when ?? ''} – ${notice.status}` };
    }
  }
}
