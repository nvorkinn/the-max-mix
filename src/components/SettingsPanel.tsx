import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Info, MicVocal, Package, Palette, SlidersHorizontal, TrainFront, Wifi } from 'lucide-react';
import type { Parcels, TouchscreenConfig } from 'countdown-api';
import { isKiosk } from '../utils/kiosk';
import { reloadSettings } from '../spotify/settings';
import type { QuietHours } from '../utils/quietHours';
import type { ScreenSleepMinutes } from '../utils/screenSleep';
import type { ThemeColour } from '../utils/themeColour';
import type { KioskUpdate } from '../hooks/useKioskUpdate';
import type { DeviceConfig, SaveStatus } from '../hooks/useDeviceConfig';
import { useParcelLink } from '../hooks/useParcelLink';
import { useT } from '../i18n/translate';
import SpotifyIcon from './SpotifyIcon';
import AboutSettings from './settings/AboutSettings';
import AppearanceSettings from './settings/AppearanceSettings';
import CountdownSettings from './settings/CountdownSettings';
import GeneralSettings from './settings/GeneralSettings';
import LyricsSettings from './settings/LyricsSettings';
import ParcelsSettings from './settings/ParcelsSettings';
import SpotifySettings from './settings/SpotifySettings';
import WifiSettings from './settings/WifiSettings';
import { SETTINGS_SECTIONS } from './settings/sections';
import type { SettingsSection } from './settings/sections';
import { useWifi } from './settings/wifi';

export type { SettingsSection } from './settings/sections';

const SECTION_ICONS: Record<SettingsSection, ReactNode> = {
  general: <SlidersHorizontal className="w-6 h-6 shrink-0" aria-hidden="true" />,
  countdown: <TrainFront className="w-6 h-6 shrink-0" aria-hidden="true" />,
  parcels: <Package className="w-6 h-6 shrink-0" aria-hidden="true" />,
  appearance: <Palette className="w-6 h-6 shrink-0" aria-hidden="true" />,
  wifi: <Wifi className="w-6 h-6 shrink-0" aria-hidden="true" />,
  spotify: <SpotifyIcon className="w-6 h-6 shrink-0" />,
  lyrics: <MicVocal className="w-6 h-6 shrink-0" aria-hidden="true" />,
  about: <Info className="w-6 h-6 shrink-0" aria-hidden="true" />
};

interface SettingsPanelProps {
  /** The page the settings start on: the first one, unless they were brought up to fix the Spotify sign-in. */
  initialSection?: SettingsSection | undefined;
  signInError?: string | null;
  onReload?: () => void;
  /** The kiosk's screen sleep delay, shown on the kiosk only. */
  screenSleep?: ScreenSleepMinutes;
  onScreenSleepChange?: (minutes: ScreenSleepMinutes) => void;
  /** The kiosk's quiet hours, shown with screen sleep. */
  quietHours?: QuietHours;
  onQuietHoursChange?: (hours: QuietHours) => void;
  themeColour?: ThemeColour;
  onThemeColourChange?: (colour: ThemeColour) => void;
  /** Whether the colours follow the album art while music plays. */
  dynamicColour?: boolean;
  onDynamicColourChange?: (on: boolean) => void;
  /** The kiosk's software update, shown on the kiosk only. */
  kioskUpdate?: KioskUpdate;
  /** Where the last save of countdown-server's config stands: a Saved tick, or a message when it didn't save. */
  saveStatus?: SaveStatus;
  /** Called each time the settings come up, to get countdown-server's config again. */
  onShow?: () => void;
  /** countdown-server's config once someone owns the kiosk, which the General and Countdown pages show and change. */
  deviceConfig?: TouchscreenConfig | undefined;
  onDeviceConfigSave?: DeviceConfig['save'] | undefined;
  /** Opens the debug console, from a button on the About page. */
  onOpenDebug?: () => void;
  /** Called after the Wi-Fi page joined a network. */
  onWifiJoined?: () => void;
  /** Whether a Wi-Fi setup from a phone (From phone or Hotspot) is under way on the Wi-Fi page. */
  onPhoneSetup?: (isActive: boolean) => void;
}

/**
 * A small Saved tick once a change has saved, or a short message when one didn't (and was undone), floating in the
 * page's corner: the page has no header of its own, as the navigation already says which one it is.
 */
function SaveNote({ status }: Readonly<{ status: SaveStatus }>) {
  const t = useT();
  return (
    <p className="settings-save-note" aria-live="polite">
      {status === 'saved' && (
        <span className="settings-status status-success">
          <Check className="settings-status-icon" aria-hidden="true" />
          {t('settings.saved')}
        </span>
      )}
      {status === 'failed' && <span className="settings-status status-warning">{t('settings.not_saved')}</span>}
    </p>
  );
}

/**
 * The Parcels page, once countdown-server has said whether the owner's account has a Parcel API key: its settings with
 * one, how to set Parcel up without. The config alone can't say, as its parcels are off either way.
 */
function ParcelsPage({
  parcels,
  onChange,
  onLinked
}: Readonly<{
  parcels: Parcels | null | undefined;
  onChange: (parcels: Parcels) => void;
  onLinked: (() => void) | undefined;
}>) {
  const linked = useParcelLink(onLinked);
  // Nothing for the moment before the answer, rather than the wrong page; parcels that are on have a key behind them.
  return linked === undefined && !parcels?.enabled ? null : (
    <ParcelsSettings parcels={parcels} keySaved={linked !== false} onChange={onChange} />
  );
}

/** The Settings tab: the sections on the left and the chosen one's page on the right. */
export default function SettingsPanel({
  initialSection,
  signInError = null,
  onReload = reloadSettings,
  screenSleep,
  onScreenSleepChange,
  quietHours,
  onQuietHoursChange,
  themeColour,
  onThemeColourChange,
  dynamicColour,
  onDynamicColourChange,
  kioskUpdate,
  saveStatus = 'idle',
  onShow,
  deviceConfig,
  onDeviceConfigSave,
  onOpenDebug,
  onWifiJoined,
  onPhoneSetup
}: Readonly<SettingsPanelProps>) {
  const t = useT();
  const [kiosk] = useState(isKiosk);
  const [section, setSection] = useState<SettingsSection | undefined>(initialSection);
  const [wifi, recheckWifi] = useWifi(kiosk);
  const update = kiosk ? kioskUpdate : undefined;
  // Screen sleep is the kiosk's only: a browser has no screen of its own to put to sleep.
  const hasSleep = kiosk && screenSleep !== undefined && onScreenSleepChange !== undefined;
  const owned = deviceConfig !== undefined && onDeviceConfigSave !== undefined;
  const sections = SETTINGS_SECTIONS.filter(
    choice =>
      (kiosk || !choice.kioskOnly) &&
      (choice.id !== 'general' || owned || hasSleep) &&
      (choice.id !== 'countdown' || owned) &&
      (choice.id !== 'parcels' || owned)
  );
  // Appearance, Spotify, Lyrics and About always show, so there is always a first page.
  const current = sections.find(choice => choice.id === section) ?? sections[0] ?? SETTINGS_SECTIONS[0];

  // Showing the settings (they mount each time the tab comes up) asks GitHub again whether a newer version is out, so the
  // answer is never the one from hours ago.
  const checkForUpdate = kioskUpdate?.checkNow;
  useEffect(() => {
    checkForUpdate?.();
  }, [checkForUpdate]);
  // The same for countdown-server's config, which the website may have changed meanwhile.
  useEffect(() => {
    onShow?.();
  }, [onShow]);

  let page: ReactNode;
  switch (current.id) {
    case 'general': {
      page = (
        <GeneralSettings
          config={owned ? deviceConfig : undefined}
          onSave={owned ? onDeviceConfigSave : undefined}
          screenSleep={hasSleep ? screenSleep : undefined}
          onScreenSleepChange={hasSleep ? onScreenSleepChange : undefined}
          quietHours={hasSleep ? quietHours : undefined}
          onQuietHoursChange={hasSleep ? onQuietHoursChange : undefined}
        />
      );
      break;
    }
    case 'countdown': {
      page = deviceConfig && onDeviceConfigSave && (
        <CountdownSettings config={deviceConfig} onSave={onDeviceConfigSave} />
      );
      break;
    }
    case 'parcels': {
      page = deviceConfig && onDeviceConfigSave && (
        <ParcelsPage
          parcels={deviceConfig.parcels}
          onChange={parcels => onDeviceConfigSave('parcels', parcels)}
          onLinked={onShow}
        />
      );
      break;
    }
    case 'appearance': {
      page = (
        <AppearanceSettings
          themeColour={themeColour}
          onThemeColourChange={onThemeColourChange}
          dynamicColour={dynamicColour}
          onDynamicColourChange={onDynamicColourChange}
        />
      );
      break;
    }
    case 'wifi': {
      page = (
        <WifiSettings
          wifi={wifi}
          onJoined={() => {
            recheckWifi();
            onWifiJoined?.();
          }}
          onPhoneSetup={onPhoneSetup}
        />
      );
      break;
    }
    case 'spotify': {
      page = <SpotifySettings signInError={signInError} onReload={onReload} />;
      break;
    }
    case 'lyrics': {
      page = <LyricsSettings onChange={owned ? lyrics => onDeviceConfigSave('lyrics', lyrics) : undefined} />;
      break;
    }
    default: {
      page = (
        <AboutSettings
          kioskUpdate={update}
          deviceConfig={owned ? deviceConfig : undefined}
          wifi={wifi}
          kiosk={kiosk}
          onOpenDebug={onOpenDebug}
        />
      );
      break;
    }
  }

  return (
    <div className="app-modal-panel settings-panel settings-tab text-left select-none">
      <nav className="settings-nav" aria-label={t('settings.title')}>
        <ul className="settings-nav-list">
          {sections.map(choice => (
            <li key={choice.id}>
              <button
                type="button"
                onClick={() => setSection(choice.id)}
                aria-current={choice.id === current.id ? 'page' : undefined}
                className="settings-nav-item"
              >
                {SECTION_ICONS[choice.id]}
                <span className="truncate">{t(`settings.${choice.id}`)}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section className="settings-content" aria-label={t(`settings.${current.id}`)}>
        <SaveNote status={saveStatus} />
        {/* Keyed by the page, so each one starts scrolled to the top. */}
        <div className="settings-content-body" key={current.id}>
          {page}
        </div>
      </section>
    </div>
  );
}
