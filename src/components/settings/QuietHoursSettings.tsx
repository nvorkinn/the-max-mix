import { Minus, Plus } from 'lucide-react';
import { formatClockTime } from '../../utils/clockFormat';
import type { ClockFormat } from '../../utils/clockFormat';
import { stepTime, timeOfDay } from '../../utils/quietHours';
import type { QuietHours } from '../../utils/quietHours';
import { useT } from '../../i18n/translate';
import SettingsToggle from './SettingsToggle';

/** One end of the quiet hours, moved half an hour at a time; it skips over `other`, as equal times would never be quiet. */
function TimeStepper({
  label,
  time,
  other,
  clockFormat,
  onChange
}: Readonly<{
  label: string;
  time: number;
  other: number;
  clockFormat: ClockFormat;
  onChange: (time: number) => void;
}>) {
  const shown = formatClockTime(timeOfDay(time), clockFormat);
  const step = (direction: 1 | -1) => {
    const next = stepTime(time, direction);
    onChange(next === other ? stepTime(next, direction) : next);
  };
  return (
    <div className="quiet-hours-time" role="group" aria-label={label}>
      <span className="quiet-hours-label">{label}</span>
      <button type="button" className="quiet-hours-step" aria-label={`${label} earlier`} onClick={() => step(-1)}>
        <Minus aria-hidden="true" />
      </button>
      <output className="quiet-hours-value">{shown}</output>
      <button type="button" className="quiet-hours-step" aria-label={`${label} later`} onClick={() => step(1)}>
        <Plus aria-hidden="true" />
      </button>
    </div>
  );
}

/** The kiosk's quiet hours (utils/quietHours): off, or the times between which the screen sleeps after a minute. */
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
      on={hours.on}
      onChange={on => onChange({ ...hours, on })}
    >
      {hours.on && (
        <div className="quiet-hours">
          <TimeStepper
            label={t('general.from')}
            time={hours.start}
            other={hours.end}
            clockFormat={clockFormat}
            onChange={start => onChange({ ...hours, start })}
          />
          <TimeStepper
            label={t('general.to')}
            time={hours.end}
            other={hours.start}
            clockFormat={clockFormat}
            onChange={end => onChange({ ...hours, end })}
          />
        </div>
      )}
    </SettingsToggle>
  );
}
