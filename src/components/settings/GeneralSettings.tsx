import { useState } from 'react';
import { CloudSun, Megaphone } from 'lucide-react';
import type { TouchscreenConfig } from 'countdown-api';
import { searchPlaces } from '../../countdown/search';
import type { DeviceConfig } from '../../hooks/useDeviceConfig';
import { DEFAULT_CLOCK_FORMAT } from '../../utils/clockFormat';
import type { QuietHours } from '../../utils/quietHours';
import type { ScreenSleepMinutes } from '../../utils/screenSleep';
import NoticeBoardDialog, { noticeBoardLabel } from './NoticeBoardDialog';
import QuietHoursSettings from './QuietHoursSettings';
import ScreenSleepSettings from './ScreenSleepSettings';
import SearchDialog from './SearchDialog';
import SettingsRow from './SettingsRow';

const CLOCK_FORMATS = [
  { id: '24h', label: '24-hour' },
  { id: '12h', label: '12-hour' }
] as const;

/** A row's Change button, which opens its dialog. */
function ChangeButton({ onClick }: Readonly<{ onClick: () => void }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="modal-option settings-action shrink-0 rounded-2xl border font-bold"
    >
      Change
    </button>
  );
}

/**
 * What applies across the whole tablet: the time format of the header clock and the Countdown's times, the place for the
 * weather, the postcode for the notice board, and on the kiosk how soon its screen sleeps and its quiet hours. The first three are kept on
 * countdown-server, so they show once someone owns the kiosk; each saves on its own as soon as it changes.
 */
export default function GeneralSettings({
  config,
  onSave,
  screenSleep,
  onScreenSleepChange,
  quietHours,
  onQuietHoursChange
}: Readonly<{
  config?: TouchscreenConfig | undefined;
  onSave?: DeviceConfig['save'] | undefined;
  screenSleep?: ScreenSleepMinutes | undefined;
  onScreenSleepChange?: ((minutes: ScreenSleepMinutes) => void) | undefined;
  quietHours?: QuietHours | undefined;
  onQuietHoursChange?: ((hours: QuietHours) => void) | undefined;
}>) {
  const [dialog, setDialog] = useState<'place' | 'notices' | null>(null);
  const notices = config && noticeBoardLabel(config.notice_board);

  return (
    <div className="settings-stack">
      {config && onSave && (
        <>
          <section className="settings-group">
            <h5 className="settings-group-title" id="clock-format-label">
              Time format
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
                  {choice.label}
                </button>
              ))}
            </div>
          </section>

          <section className="settings-group">
            <h5 className="settings-group-title">Weather</h5>
            <SettingsRow
              icon={<CloudSun className="w-6 h-6" aria-hidden="true" />}
              name={config.weather.key ? config.weather.location : 'No place'}
            >
              <ChangeButton onClick={() => setDialog('place')} />
            </SettingsRow>
          </section>

          <section className="settings-group">
            <h5 className="settings-group-title">Postcode</h5>
            <SettingsRow icon={<Megaphone className="w-6 h-6" aria-hidden="true" />} name={notices ?? 'Off'}>
              <ChangeButton onClick={() => setDialog('notices')} />
            </SettingsRow>
          </section>
        </>
      )}

      {screenSleep !== undefined && onScreenSleepChange && (
        <ScreenSleepSettings minutes={screenSleep} onChange={onScreenSleepChange} />
      )}

      {quietHours && onQuietHoursChange && (
        <QuietHoursSettings
          hours={quietHours}
          clockFormat={config?.clock_format ?? DEFAULT_CLOCK_FORMAT}
          onChange={onQuietHoursChange}
        />
      )}

      {config && onSave && dialog === 'place' && (
        <SearchDialog
          title="Weather place"
          search={searchPlaces}
          initialQuery={config.weather.key ? config.weather.location : ''}
          onClose={() => setDialog(null)}
          onPick={result => {
            onSave('weather', result.value);
            setDialog(null);
          }}
        />
      )}
      {config && onSave && dialog === 'notices' && (
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
