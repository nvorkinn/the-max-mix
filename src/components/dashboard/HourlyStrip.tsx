import { RefreshCw } from 'lucide-react';
import type { HourlyStripProps } from '../../dashboard/props';
import { SKY_ICONS, sunny } from './icons';

/** The hour as the place's own clock read it: the ISO time's hour, whatever zone this browser is in. */
function hourLabel(time: string, clockFormat: HourlyStripProps['clockFormat']): string {
  const [, hours = '00', minutes = '00'] = /T(\d\d):(\d\d)/.exec(time) ?? [];
  if (clockFormat === '24h') return `${hours}:${minutes}`;
  const hour = Number(hours);
  const clock = minutes === '00' ? String(hour % 12 || 12) : `${hour % 12 || 12}:${minutes}`;
  return `${clock} ${hour < 12 ? 'AM' : 'PM'}`;
}

function updatedLabel(updatedAt: string, now: Date, stale: boolean): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(updatedAt).getTime()) / 60_000));
  if (!stale && minutes < 1) return 'Updated just now';
  const ago = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h`;
  return `Updated ${ago} ago`;
}

/** The next five hours of forecast and when the data was last read. */
export default function HourlyStrip({ hours, updatedAt, stale, now, clockFormat }: Readonly<HourlyStripProps>) {
  return (
    <section aria-label="Hourly forecast" data-stale={stale}>
      <div className="dashboard-hours">
        {hours.slice(0, 5).map(hour => {
          const Icon = SKY_ICONS[hour.sky][hour.isDay ? 'day' : 'night'];
          return (
            <div className="dashboard-hour" key={hour.time}>
              <time dateTime={hour.time}>{hourLabel(hour.time, clockFormat)}</time>
              <Icon
                className="lucide"
                aria-hidden="true"
                style={sunny(hour.sky, hour.isDay) ? { color: '#f6c453' } : undefined}
              />
              <strong>{hour.temperature}°</strong>
            </div>
          );
        })}
      </div>
      <p className="dashboard-updated">
        {updatedLabel(updatedAt, now, stale)}
        <RefreshCw className="lucide" aria-hidden="true" />
      </p>
    </section>
  );
}
