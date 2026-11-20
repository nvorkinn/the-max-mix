import type { HourlyStripProps } from '../../dashboard/props';
import { useT } from '../../i18n/translate';
import { SKY_ICONS, sunny } from './icons';

/** The hour as the place's own clock read it: the ISO time's hour, whatever zone this browser is in. */
function hourLabel(time: string, clockFormat: HourlyStripProps['clockFormat']): string {
  const [, hours = '00', minutes = '00'] = /T(\d\d):(\d\d)/.exec(time) ?? [];
  if (clockFormat === '24h') return `${hours}:${minutes}`;
  const hour = Number(hours);
  const clock = minutes === '00' ? String(hour % 12 || 12) : `${hour % 12 || 12}:${minutes}`;
  return `${clock} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** The next five hours of forecast. */
export default function HourlyStrip({ hours, stale, clockFormat }: Readonly<HourlyStripProps>) {
  const t = useT();
  return (
    <section aria-label={t('dashboard.hourly_forecast')} data-stale={stale}>
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
    </section>
  );
}
