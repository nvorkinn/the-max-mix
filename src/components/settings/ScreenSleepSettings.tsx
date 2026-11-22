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
      <div className="settings-segmented" role="group" aria-labelledby="screen-sleep-label">
        {SCREEN_SLEEP_CHOICES.map(choice => (
          <button
            type="button"
            key={choice}
            aria-pressed={minutes === choice}
            onClick={() => onChange(choice)}
            className="settings-segment"
          >
            {choice === 0 ? t('general.never') : t('general.minutes', { minutes: choice })}
          </button>
        ))}
      </div>
    </section>
  );
}
