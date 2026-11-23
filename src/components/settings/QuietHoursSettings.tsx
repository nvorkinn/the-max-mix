import type { ClockFormat } from '../../utils/clockFormat';
import type { QuietHours } from '../../utils/quietHours';
import { useT } from '../../i18n/translate';
import QuietHoursTimeline from './QuietHoursTimeline';
import SettingsToggle from './SettingsToggle';

/** The kiosk's quiet hours (utils/quietHours): off, or the stretch of the day, drawn on it, when the screen sleeps after a minute. */
export default function QuietHoursSettings({
  hours,
  clockFormat,
  onChange
}: Readonly<{ hours: QuietHours; clockFormat: ClockFormat; onChange: (hours: QuietHours) => void }>) {
  const t = useT();
  return (
    <SettingsToggle
      id="quiet-hours-label"
      title={t('general.quiet_hours')}
      note={t('quiet.caption')}
      on={hours.on}
      onChange={on => onChange({ ...hours, on })}
    >
      {hours.on && <QuietHoursTimeline hours={hours} clockFormat={clockFormat} onChange={onChange} />}
    </SettingsToggle>
  );
}
