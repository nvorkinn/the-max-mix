import type { TouchscreenHolidays } from 'countdown-api';
import { useT } from '../../i18n/translate';
import { DEFAULT_HOLIDAY_DAYS_AHEAD } from '../../dashboard/notices';
import SettingsChips from './SettingsChips';
import SettingsSection from './SettingsSection';

type DaysAhead = TouchscreenHolidays['days_ahead'];

/** How soon the notice board mentions the next holiday, in days before it: the contract's choices. */
const DAYS_AHEAD_CHOICES: readonly DaysAhead[] = [2, 4, 7, 14];

/**
 * The Notices page's Bank holidays: how many days before the next bank holiday (or a Norwegian board's public holiday)
 * the notice board mentions it. Each tap saves it to countdown-server, as the config's `holidays`.
 */
export default function HolidaysSettings({
  holidays,
  onChange
}: Readonly<{
  holidays: TouchscreenHolidays | undefined;
  onChange: (holidays: TouchscreenHolidays) => void;
}>) {
  const t = useT();
  const label = (days: DaysAhead) =>
    days % 7 === 0 ? t('holidays.weeks_before', { weeks: days / 7 }) : t('holidays.days_before', { days });
  return (
    <SettingsSection id="holidays-label" title={t('holidays.title')}>
      <SettingsChips
        labelledBy="holidays-label"
        value={holidays?.days_ahead ?? DEFAULT_HOLIDAY_DAYS_AHEAD}
        onChange={days_ahead => onChange({ days_ahead })}
        options={DAYS_AHEAD_CHOICES.map(days => ({ id: days, label: label(days) }))}
      />
    </SettingsSection>
  );
}
