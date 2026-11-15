import type { ClockFormat } from '../../utils/clockFormat';

const CLOCK_FORMATS = [
  { id: '24h', label: '24-hour' },
  { id: '12h', label: '12-hour' }
] as const;

/** What applies across the whole tablet: the time format of the header clock and the Dashboard's times. */
export default function GeneralSettings({
  clockFormat,
  onClockFormatChange
}: Readonly<{ clockFormat: ClockFormat; onClockFormatChange: (format: ClockFormat) => void }>) {
  return (
    <div className="settings-stack">
      <section className="settings-group">
        <h5 className="settings-group-title" id="clock-format-label">
          Time format
        </h5>
        <div className="settings-segmented dashboard-segmented" role="group" aria-labelledby="clock-format-label">
          {CLOCK_FORMATS.map(choice => (
            <button
              type="button"
              key={choice.id}
              aria-pressed={clockFormat === choice.id}
              onClick={() => onClockFormatChange(choice.id)}
              className="settings-segment"
            >
              {choice.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
