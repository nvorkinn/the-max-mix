import type { TouchscreenConfig } from 'countdown-api';

/** How the tablet writes clock times everywhere a person reads one: 24-hour (16:05) or 12-hour (4:05 PM). */
export type ClockFormat = TouchscreenConfig['clock_format'];

/** The format until countdown-server says otherwise: the kiosk's own clock has always been 24-hour. */
export const DEFAULT_CLOCK_FORMAT: ClockFormat = '24h';

/** A time of day as hours and minutes, in the chosen format. Machine times (logs, debug consoles) stay 24-hour. */
export function formatClockTime(time: Date, format: ClockFormat): string {
  const twelve = format === '12h';
  return time.toLocaleTimeString([], {
    hour: twelve ? 'numeric' : '2-digit',
    minute: '2-digit',
    hourCycle: twelve ? 'h12' : 'h23'
  });
}
