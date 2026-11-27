import { SCREEN_SLEEP_CHOICES } from '../../utils/screenSleep';
import type { ScreenSleepMinutes } from '../../utils/screenSleep';
import { useT } from '../../i18n/translate';
import SettingsChips from './SettingsChips';
import SettingsSection from './SettingsSection';

/** The kiosk's screen sleep delay: off, or minutes from the Dashboard dimming to the screen going dark. */
export default function ScreenSleepSettings({
  minutes,
  onChange
}: Readonly<{ minutes: ScreenSleepMinutes; onChange: (minutes: ScreenSleepMinutes) => void }>) {
  const t = useT();
  return (
    <SettingsSection id="screen-sleep-label" title={t('general.screen_sleep')}>
      <SettingsChips
        labelledBy="screen-sleep-label"
        value={minutes}
        onChange={onChange}
        options={SCREEN_SLEEP_CHOICES.map(choice => ({
          id: choice,
          label: choice === 0 ? t('general.never') : t('general.minutes', { minutes: choice })
        }))}
      />
    </SettingsSection>
  );
}
