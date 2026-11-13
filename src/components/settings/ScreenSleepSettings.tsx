import { Check } from 'lucide-react';
import { SCREEN_SLEEP_CHOICES } from '../../utils/screenSleep';
import type { ScreenSleepMinutes } from '../../utils/screenSleep';

/** The kiosk's screen sleep delay: off, or minutes without a touch while nothing plays. */
export default function ScreenSleepSettings({
  minutes,
  onChange,
  labelledBy
}: Readonly<{ minutes: ScreenSleepMinutes; onChange: (minutes: ScreenSleepMinutes) => void; labelledBy: string }>) {
  return (
    <div className="settings-stack">
      <p className="text-muted">The screen sleeps after this long without a touch, while no music is playing.</p>
      <div className="settings-choices" role="group" aria-labelledby={labelledBy}>
        {SCREEN_SLEEP_CHOICES.map(choice => (
          <button
            type="button"
            key={choice}
            aria-pressed={minutes === choice}
            onClick={() => onChange(choice)}
            className="settings-choice"
          >
            {minutes === choice && <Check className="w-5 h-5 shrink-0" aria-hidden="true" />}
            {choice === 0 ? 'Never' : `${choice} min`}
          </button>
        ))}
      </div>
    </div>
  );
}
