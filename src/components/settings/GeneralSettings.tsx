import { useState } from 'react';
import { CloudSun, Megaphone } from 'lucide-react';
import type { TouchscreenConfig } from 'countdown-api';
import { locatePlace, searchPlaces } from '../../countdown/search';
import type { DeviceConfig } from '../../hooks/useDeviceConfig';
import { useT } from '../../i18n/translate';
import type { StringId } from '../../i18n/strings';
import CountryFlag from './CountryFlag';
import NoticeBoardDialog, { noticeBoardPlace } from './NoticeBoardDialog';
import SearchDialog from './SearchDialog';
import SettingsRow from './SettingsRow';

const CLOCK_FORMATS: readonly { id: TouchscreenConfig['clock_format']; label: StringId }[] = [
  { id: '24h', label: 'general.24h' },
  { id: '12h', label: 'general.12h' }
];

// Each language by its own name, whichever the tablet is in, so someone who can't read the other one finds theirs.
const LANGUAGES: readonly { id: TouchscreenConfig['language']; name: string; lang: string }[] = [
  { id: 'en', name: 'English', lang: 'en' },
  { id: 'nb', name: 'Norsk', lang: 'nb' }
];

/** A row's Change button, which opens its dialog. */
function ChangeButton({ onClick }: Readonly<{ onClick: () => void }>) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      className="modal-option settings-action shrink-0 rounded-2xl border font-bold"
    >
      {t('common.change')}
    </button>
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

  return (
    <div className="settings-stack">
      <div className="settings-pair">
        <section className="settings-group">
          <h5 className="settings-group-title" id="language-label">
            {t('general.language')}
          </h5>
          <div className="settings-segmented" role="group" aria-labelledby="language-label">
            {LANGUAGES.map(choice => (
              <button
                type="button"
                key={choice.id}
                lang={choice.lang}
                aria-pressed={config.language === choice.id}
                onClick={() => onSave('language', choice.id)}
                className="settings-segment"
              >
                {choice.name}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-group">
          <h5 className="settings-group-title" id="clock-format-label">
            {t('general.time_format')}
          </h5>
          <div className="settings-segmented" role="group" aria-labelledby="clock-format-label">
            {CLOCK_FORMATS.map(choice => (
              <button
                type="button"
                key={choice.id}
                aria-pressed={config.clock_format === choice.id}
                onClick={() => onSave('clock_format', choice.id)}
                className="settings-segment"
              >
                {t(choice.label)}
              </button>
            ))}
          </div>
        </section>
      </div>
      <div className="settings-pair">
        <section className="settings-group">
          <h5 className="settings-group-title">{t('general.weather')}</h5>
          <SettingsRow
            icon={<CloudSun className="w-6 h-6" aria-hidden="true" />}
            name={config.weather.key ? config.weather.location : t('general.no_place')}
          >
            <ChangeButton onClick={() => setDialog('place')} />
          </SettingsRow>
        </section>

        <section className="settings-group">
          <h5 className="settings-group-title">{t('general.postcode')}</h5>
          <SettingsRow
            icon={
              notices ? <CountryFlag country={notices.country} /> : <Megaphone className="w-6 h-6" aria-hidden="true" />
            }
            name={notices?.postcode ?? t('common.off')}
          >
            <ChangeButton onClick={() => setDialog('notices')} />
          </SettingsRow>
        </section>
      </div>

      {dialog === 'place' && (
        <SearchDialog
          title={t('general.weather_place')}
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
