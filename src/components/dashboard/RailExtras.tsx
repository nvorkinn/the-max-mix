import type { HourlyStripProps } from '../../dashboard/props';
import { SKY_ICONS, sunny } from './icons';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The next days under the weather: each day's sky and its low to high. */
export function DayOutlook({ days = [] }: Readonly<Pick<HourlyStripProps, 'days'>>) {
  if (days.length === 0) return null;
  const lowest = Math.min(...days.map(day => day.low));
  const highest = Math.max(...days.map(day => day.high));
  const span = Math.max(1, highest - lowest);
  return (
    <ol className="dashboard-outlook" aria-label="Next days">
      {days.map(day => {
        const Icon = SKY_ICONS[day.sky].day;
        const weekday = WEEKDAYS[new Date(`${day.date}T12:00:00Z`).getUTCDay()] ?? '';
        return (
          <li key={day.date}>
            <span className="dashboard-outlook-day">{weekday}</span>
            <Icon
              className="lucide"
              aria-hidden="true"
              style={sunny(day.sky, true) ? { color: '#f6c453' } : undefined}
            />
            <span className="dashboard-outlook-low">{day.low}°</span>
            <span className="dashboard-outlook-range">
              <span
                style={{
                  left: `${((day.low - lowest) / span) * 100}%`,
                  right: `${((highest - day.high) / span) * 100}%`
                }}
              />
            </span>
            <strong>{day.high}°</strong>
          </li>
        );
      })}
    </ol>
  );
}

const CURVE_WIDTH = 296;
const CURVE_HEIGHT = 64;

function hourText(time: string, clockFormat: HourlyStripProps['clockFormat']): string {
  const hour = Number(/T(\d\d)/.exec(time)?.[1] ?? 0);
  if (clockFormat === '24h') return `${String(hour).padStart(2, '0')}:00`;
  return `${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'}`;
}

/** The next twelve hours under the weather: their temperatures as a line, every other hour's sky and time. */
export function HourCurve({ hours, clockFormat }: Readonly<Pick<HourlyStripProps, 'hours' | 'clockFormat'>>) {
  const shown = hours.slice(0, 12);
  if (shown.length < 2) return null;
  const temps = shown.map(hour => hour.temperature);
  const low = Math.min(...temps);
  const high = Math.max(...temps);
  const step = CURVE_WIDTH / shown.length;
  const x = (index: number) => step * index + step / 2;
  const y = (temperature: number) => 30 + (1 - (temperature - low) / Math.max(1, high - low)) * (CURVE_HEIGHT - 40);
  const points = shown.map((hour, index) => `${x(index).toFixed(1)},${y(hour.temperature).toFixed(1)}`).join(' ');
  const marked = shown.flatMap((hour, index) => (index % 2 === 0 ? [{ hour, index }] : []));
  return (
    <div className="dashboard-curve" aria-label="Next hours">
      <div className="dashboard-curve-icons">
        {marked.map(({ hour }) => {
          const Icon = SKY_ICONS[hour.sky][hour.isDay ? 'day' : 'night'];
          return (
            <Icon
              key={hour.time}
              className="lucide"
              aria-hidden="true"
              style={sunny(hour.sky, hour.isDay) ? { color: '#f6c453' } : undefined}
            />
          );
        })}
      </div>
      <svg width={CURVE_WIDTH} height={CURVE_HEIGHT} viewBox={`0 0 ${CURVE_WIDTH} ${CURVE_HEIGHT}`} aria-hidden="true">
        <polyline points={points} />
        {marked.map(({ hour, index }) => (
          <g key={hour.time}>
            <circle cx={x(index)} cy={y(hour.temperature)} r={3.5} />
            <text x={x(index)} y={y(hour.temperature) - 10}>
              {hour.temperature}°
            </text>
          </g>
        ))}
      </svg>
      <div className="dashboard-curve-times">
        {marked.map(({ hour }) => (
          <time key={hour.time} dateTime={hour.time}>
            {hourText(hour.time, clockFormat)}
          </time>
        ))}
      </div>
    </div>
  );
}
