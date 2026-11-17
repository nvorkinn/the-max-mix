// The kiosk's quiet hours: a stretch of the day (it may run past midnight) when the screen sleeps a minute after the last
// touch, on any tab, whatever the screen sleep delay says. Kept on the kiosk only. Storage can be unavailable: every
// access tolerates that.

const QUIET_HOURS_KEY = 'maxmix.quietHours';

/** Quiet hours as minutes after midnight; `end` before `start` runs past midnight. Off keeps the times for next time. */
export interface QuietHours {
  on: boolean;
  start: number;
  end: number;
}

/** The step the settings move a time by, in minutes. */
const QUIET_HOURS_STEP = 30;
const DAY_MINUTES = 24 * 60;
export const DEFAULT_QUIET_HOURS: QuietHours = { on: false, start: 22 * 60, end: 7 * 60 };

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < DAY_MINUTES;
}

export function loadQuietHours(): QuietHours {
  try {
    const stored = localStorage.getItem(QUIET_HOURS_KEY);
    if (stored === null) return DEFAULT_QUIET_HOURS;
    const parsed = JSON.parse(stored) as Partial<QuietHours> | null;
    return typeof parsed?.on === 'boolean' && isTime(parsed.start) && isTime(parsed.end)
      ? { on: parsed.on, start: parsed.start, end: parsed.end }
      : DEFAULT_QUIET_HOURS;
  } catch {
    return DEFAULT_QUIET_HOURS;
  }
}

export function saveQuietHours(hours: QuietHours): void {
  try {
    localStorage.setItem(QUIET_HOURS_KEY, JSON.stringify(hours));
  } catch {
    // Storage is unavailable; the setting then lasts only until the page reloads.
  }
}

/** Whether `now` falls in the quiet hours: from `start` up to, not including, `end`. Equal times are never quiet. */
export function isQuietTime(hours: QuietHours, now: Date): boolean {
  if (!hours.on || hours.start === hours.end) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  return hours.start < hours.end
    ? minute >= hours.start && minute < hours.end
    : minute >= hours.start || minute < hours.end;
}

/** `time` moved by `steps` of QUIET_HOURS_STEP, round the clock. */
export function stepTime(time: number, steps: number): number {
  return (((time + steps * QUIET_HOURS_STEP) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

/** Minutes after midnight as a Date today, for formatting with the tablet's clock format. */
export function timeOfDay(time: number): Date {
  const date = new Date();
  date.setHours(Math.floor(time / 60), time % 60, 0, 0);
  return date;
}
