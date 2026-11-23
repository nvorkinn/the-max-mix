import { useState } from 'react';
import type { ReactNode } from 'react';
import type { TouchscreenConfig } from 'countdown-api';
import { locatePlace, searchPlaces } from '../../countdown/search';
import { useClock } from '../../hooks/useClock';
import type { DeviceConfig } from '../../hooks/useDeviceConfig';
import { formatClockTime } from '../../utils/clockFormat';
import { useT } from '../../i18n/translate';
import type { StringId } from '../../i18n/strings';
import CountryFlag from './CountryFlag';
import NoticeBoardDialog, { noticeBoardPlace } from './NoticeBoardDialog';
import SearchDialog from './SearchDialog';
import SettingsSection from './SettingsSection';

const CLOCK_FORMATS: readonly { id: TouchscreenConfig['clock_format']; label: StringId }[] = [
  { id: '24h', label: 'general.24h' },
  { id: '12h', label: 'general.12h' }
];

// Each language by its own name, whichever the tablet is in, so someone who can't read the other one finds theirs, with
// the flag of the country it is spoken in.
const LANGUAGES: readonly { id: TouchscreenConfig['language']; name: string; lang: string; country: 'GB' | 'NO' }[] = [
  { id: 'en', name: 'English', lang: 'en', country: 'GB' },
  { id: 'nb', name: 'Norsk', lang: 'nb', country: 'NO' }
];

/**
 * A setting that is a value chosen in a dialog (the weather's place, the postcode): the value as it is now, and the
 * Change button that opens the dialog beside it.
 */
function ValueSection({
  id,
  title,
  caption,
  value,
  muted,
  onChange
}: Readonly<{ id: string; title: string; caption: string; value: ReactNode; muted: boolean; onChange: () => void }>) {
  const t = useT();
  return (
    <SettingsSection id={id} title={title} caption={caption}>
      <div className="settings-value">
        <span className={`settings-value-text truncate ${muted ? 'text-muted' : ''}`}>{value}</span>
        <button
          type="button"
          onClick={onChange}
          aria-describedby={id}
          className="modal-option settings-action shrink-0 rounded-2xl border font-bold"
        >
          {t('common.change')}
        </button>
      </div>
    </SettingsSection>
  );
}

/**
 * What applies across the whole tablet: its language, the time format of the header clock and the Countdown's times, the
 * place for the weather and the postcode for the notice board. They are kept on countdown-server, so the page shows once
 * someone owns the kiosk; each saves on its own as soon as it changes.
 */
export default function GeneralSettings({
  config,
  onSave
}: Readonly<{ config: TouchscreenConfig; onSave: DeviceConfig['save'] }>) {
  const t = useT();
  const [dialog, setDialog] = useState<'place' | 'notices' | null>(null);
  const notices = noticeBoardPlace(config.notice_board);
  const now = useClock();

  return (
    <div className="settings-stack">
      <SettingsSection id="language-label" title={t('general.language')}>
        <div className="settings-choices" role="group" aria-labelledby="language-label">
          {LANGUAGES.map(choice => (
            <button
              type="button"
              key={choice.id}
              lang={choice.lang}
              aria-pressed={config.language === choice.id}
              onClick={() => onSave('language', choice.id)}
              className="settings-choice"
            >
              <span aria-hidden="true">
                <CountryFlag country={choice.country} className="settings-choice-flag" />
              </span>
              <span className="settings-choice-name">{choice.name}</span>
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection id="clock-format-label" title={t('general.time_format')}>
        <div className="settings-choices" role="group" aria-labelledby="clock-format-label">
          {CLOCK_FORMATS.map(choice => (
            <button
              type="button"
              key={choice.id}
              aria-pressed={config.clock_format === choice.id}
              onClick={() => onSave('clock_format', choice.id)}
              className="settings-choice is-stacked"
            >
              <span className="settings-choice-clock" aria-hidden="true">
                {formatClockTime(now, choice.id)}
              </span>
              <span className="settings-choice-note">{t(choice.label)}</span>
            </button>
          ))}
        </div>
      </SettingsSection>

      <ValueSection
        id="location-label"
        title={t('general.location')}
        caption={t('general.location_caption')}
        value={config.weather.key ? config.weather.location : t('general.no_place')}
        muted={!config.weather.key}
        onChange={() => setDialog('place')}
      />

      <ValueSection
        id="postcode-label"
        title={t('general.postcode')}
        caption={t('general.postcode_caption')}
        value={
          notices ? (
            <>
              <CountryFlag country={notices.country} />
              {notices.postcode}
            </>
          ) : (
            t('common.off')
          )
        }
        muted={!notices}
        onChange={() => setDialog('notices')}
      />

      {dialog === 'place' && (
        <SearchDialog
          title={t('general.location')}
          search={searchPlaces}
          locate={locatePlace}
          initialQuery={config.weather.key ? config.weather.location : ''}
          onClose={() => setDialog(null)}
          onPick={result => {
            onSave('weather', result.value);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'notices' && (
        <NoticeBoardDialog
          board={config.notice_board}
          onClose={() => setDialog(null)}
          onSave={board => {
            onSave('notice_board', board);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
