import { Check } from 'lucide-react';
import { SCREEN_SLEEP_CHOICES } from '../../utils/screenSleep';
import type { ScreenSleepMinutes } from '../../utils/screenSleep';
import { useT } from '../../i18n/translate';

/** The kiosk's screen sleep delay: off, or minutes from the Dashboard dimming to the screen going dark. */
export default function ScreenSleepSettings({
  minutes,
  onChange
}: Readonly<{ minutes: ScreenSleepMinutes; onChange: (minutes: ScreenSleepMinutes) => void }>) {
  const t = useT();
  return (
    <section className="settings-group">
      <h5 className="settings-group-title" id="screen-sleep-label">
        {t('general.screen_sleep')}
      </h5>
      <div className="settings-choices" role="group" aria-labelledby="screen-sleep-label">
        {SCREEN_SLEEP_CHOICES.map(choice => (
          <button
            type="button"
            key={choice}
            aria-pressed={minutes === choice}
            onClick={() => onChange(choice)}
            className="settings-choice"
          >
            {minutes === choice && <Check className="w-5 h-5 shrink-0" aria-hidden="true" />}
            {choice === 0 ? t('general.never') : t('general.minutes', { minutes: choice })}
          </button>
        ))}
      </div>
    </section>
  );
}
