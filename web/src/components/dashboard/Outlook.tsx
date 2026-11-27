import type { OutlookProps } from '../../dashboard/props';
import { useLanguage } from '../../i18n/language';
import type { Language } from '../../i18n/language';
import { translate } from '../../i18n/translate';
import { SKY_ICONS, sunny } from './icons';

// Each language's weekdays, Sunday first, as short as the column is narrow.
const WEEKDAYS: Readonly<Record<Language, readonly string[]>> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  nb: ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør']
};

/**
 * The days after today under the weather, a row each: the weekday, its sky, its low and high, and a bar for that range
 * against the whole outlook's.
 */
export default function Outlook({ days }: Readonly<OutlookProps>) {
  const language = useLanguage();
  if (days.length === 0) return null;
  const lowest = Math.min(...days.map(day => day.low));
  const span = Math.max(1, Math.max(...days.map(day => day.high)) - lowest);
  return (
    <ol className="dashboard-outlook shadowed" aria-label={translate('dashboard.next_days', language)}>
      {days.map(day => {
        const Icon = SKY_ICONS[day.sky].day;
        return (
          <li key={day.date}>
            <span className="dashboard-outlook-day">
              {WEEKDAYS[language][new Date(`${day.date}T12:00:00Z`).getUTCDay()]}
            </span>
            <Icon
              className="lucide"
              aria-hidden="true"
              style={sunny(day.sky, true) ? { color: '#f6c453' } : undefined}
            />
            <span className="dashboard-outlook-low">{day.low}°</span>
            <span className="dashboard-outlook-range" aria-hidden="true">
              <span
                style={{
                  left: `${String(((day.low - lowest) / span) * 100)}%`,
                  width: `${String(((day.high - day.low) / span) * 100)}%`
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
