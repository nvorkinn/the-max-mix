import { useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { formatClockTime } from '../../utils/clockFormat';
import type { ClockFormat } from '../../utils/clockFormat';
import { isQuietTime, stepTime, timeOfDay } from '../../utils/quietHours';
import type { QuietHours } from '../../utils/quietHours';
import { useClock } from '../../hooks/useClock';
import { useT } from '../../i18n/translate';

const DAY_MINUTES = 24 * 60;
const STEP_MINUTES = 30;
const HOUR_MARKS = [0, 6, 12, 18, 24] as const;

/** Where on the day a time sits, in percent, for the band, the handles and the clock's mark. */
const at = (minutes: number): string => `${(minutes / DAY_MINUTES) * 100}%`;

/** The time under a point on the track, to the nearest half hour, round the clock. */
function timeAt(clientX: number, track: DOMRect): number {
  const share = Math.min(1, Math.max(0, (clientX - track.left) / Math.max(1, track.width)));
  return (Math.round((share * DAY_MINUTES) / STEP_MINUTES) * STEP_MINUTES) % DAY_MINUTES;
}

/** How far apart two times are round the clock, in minutes. */
const apart = (a: number, b: number): number => Math.min(Math.abs(a - b), DAY_MINUTES - Math.abs(a - b));

/** An hour mark's label in the tablet's clock format: 00 06 12 18 24, or 12a 6a 12p 6p 12a. */
function hourLabel(hour: number, format: ClockFormat): string {
  if (format === '24h') return String(hour).padStart(2, '0');
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${hour % 24 < 12 ? 'a' : 'p'}`;
}

/**
 * The quiet hours drawn on the day: a band from one end to the other (running past midnight wraps it round), each end a
 * handle to drag, or to step half an hour with the arrow keys, and a mark at the time now. Tapping the day moves the
 * nearer end there. The ends never meet, as equal times would never be quiet.
 */
export default function QuietHoursTimeline({
  hours,
  clockFormat,
  onChange
}: Readonly<{ hours: QuietHours; clockFormat: ClockFormat; onChange: (hours: QuietHours) => void }>) {
  type End = 'start' | 'end';
  const t = useT();
  const now = useClock();
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<End | null>(null);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const show = (time: number) => formatClockTime(timeOfDay(time), clockFormat);
  const other = (end: End): End => (end === 'start' ? 'end' : 'start');

  const set = (end: End, time: number) => {
    if (time === hours[other(end)] || time === hours[end]) return;
    onChange({ ...hours, [end]: time });
  };
  const step = (end: End, direction: 1 | -1) => {
    const next = stepTime(hours[end], direction);
    set(end, next === hours[other(end)] ? stepTime(next, direction) : next);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track) return;
    const time = timeAt(event.clientX, track.getBoundingClientRect());
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-end]')?.dataset['end'] as End | undefined;
    const end = handle ?? (apart(time, hours.start) <= apart(time, hours.end) ? 'start' : 'end');
    track.setPointerCapture(event.pointerId);
    setDragging(end);
    if (!handle) set(end, time);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (dragging === null || !track) return;
    set(dragging, timeAt(event.clientX, track.getBoundingClientRect()));
  };
  const onPointerUp = () => setDragging(null);

  const onKeyDown = (end: End) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') step(end, 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') step(end, -1);
    else return;
    event.preventDefault();
  };

  const wraps = hours.start > hours.end;
  const bands = wraps
    ? [
        { left: hours.start, width: DAY_MINUTES - hours.start },
        { left: 0, width: hours.end }
      ]
    : [{ left: hours.start, width: hours.end - hours.start }];
  const quietNow = isQuietTime(hours, now);

  return (
    <div className="quiet-timeline">
      <div
        ref={trackRef}
        className="quiet-timeline-track"
        data-dragging={dragging ?? undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="quiet-timeline-day" aria-hidden="true">
          {HOUR_MARKS.slice(1, -1).map(hour => (
            <span key={hour} className="quiet-timeline-tick" style={{ left: at(hour * 60) }} />
          ))}
          {bands.map(band => (
            <span
              key={band.left}
              className="quiet-timeline-band"
              style={{ left: at(band.left), width: at(band.width) }}
            />
          ))}
          <span className="quiet-timeline-now" style={{ left: at(nowMinutes) }} />
        </span>
        {(['start', 'end'] as const).map(end => {
          const label = t(end === 'start' ? 'general.from' : 'general.to');
          return (
            <div
              key={end}
              data-end={end}
              role="slider"
              tabIndex={0}
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={DAY_MINUTES - STEP_MINUTES}
              aria-valuenow={hours[end]}
              aria-valuetext={show(hours[end])}
              onKeyDown={onKeyDown(end)}
              className="quiet-timeline-handle"
              style={{ '--at': at(hours[end]) } as CSSProperties}
            >
              <span className="quiet-timeline-handle-time" aria-hidden="true">
                {show(hours[end])}
              </span>
            </div>
          );
        })}
      </div>
      <div className="quiet-timeline-hours" aria-hidden="true">
        {HOUR_MARKS.map(hour => (
          <span key={hour}>{hourLabel(hour, clockFormat)}</span>
        ))}
      </div>
      <p className="quiet-timeline-readout">
        <strong>
          {show(hours.start)} – {show(hours.end)}
        </strong>
        <span className="text-muted">
          {' · '}
          {quietNow ? t('quiet.now_quiet') : t('quiet.now_awake', { time: show(nowMinutes) })}
        </span>
      </p>
    </div>
  );
}
