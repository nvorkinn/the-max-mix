import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Info, LayoutGrid, Palette, SlidersHorizontal, TrainFront, Wifi } from 'lucide-react';
import type { TouchscreenConfig } from 'countdown-api';
import { isKiosk } from '../utils/kiosk';
import { reloadSettings } from '../spotify/settings';
import type { ScreenSleepMinutes } from '../utils/screenSleep';
import type { ThemeColour } from '../utils/themeColour';
import type { DashboardLayout } from '../utils/dashboardLayout';
import type { Skin, Theme } from '../utils/theme';
import type { KioskUpdate } from '../hooks/useKioskUpdate';
import type { DeviceConfig, SaveStatus } from '../hooks/useDeviceConfig';
import SpotifyIcon from './SpotifyIcon';
import AboutSettings from './settings/AboutSettings';
import AppearanceSettings from './settings/AppearanceSettings';
import CountdownSettings from './settings/CountdownSettings';
import GeneralSettings from './settings/GeneralSettings';
import SettingsOverview from './settings/SettingsOverview';
import SpotifySettings from './settings/SpotifySettings';
import WifiSettings from './settings/WifiSettings';
import { SETTINGS_SECTIONS } from './settings/sections';
import type { SettingsSection } from './settings/sections';
import { useWifi } from './settings/wifi';

export type { SettingsSection } from './settings/sections';

const SECTION_ICONS: Record<SettingsSection, ReactNode> = {
  overview: <LayoutGrid className="w-6 h-6 shrink-0" aria-hidden="true" />,
  general: <SlidersHorizontal className="w-6 h-6 shrink-0" aria-hidden="true" />,
  countdown: <TrainFront className="w-6 h-6 shrink-0" aria-hidden="true" />,
  appearance: <Palette className="w-6 h-6 shrink-0" aria-hidden="true" />,
  wifi: <Wifi className="w-6 h-6 shrink-0" aria-hidden="true" />,
  spotify: <SpotifyIcon className="w-6 h-6 shrink-0" />,
  about: <Info className="w-6 h-6 shrink-0" aria-hidden="true" />
};

interface SettingsPanelProps {
  /** The page the settings start on: Overview, unless they were brought up to fix the Spotify sign-in. */
  initialSection?: SettingsSection;
  authInfo?: { authenticated?: boolean };
  signInError?: string | null;
  onReload?: () => void;
  /** The kiosk's screen sleep delay, shown on the kiosk only. */
  screenSleep?: ScreenSleepMinutes;
  onScreenSleepChange?: (minutes: ScreenSleepMinutes) => void;
  themeColour?: ThemeColour;
  onThemeColourChange?: (colour: ThemeColour) => void;
  dashboardLayout?: DashboardLayout;
  onDashboardLayoutChange?: (layout: DashboardLayout) => void;
  theme?: Theme;
  /** Whether Auto (sunrise to sunset) is offered: only when the kiosk knows its location. */
  autoTheme?: boolean;
  onThemeChange?: (theme: Theme) => void;
  /** The skin on screen now (Auto resolves to Day or Night); the colour choice only applies to Day. */
  skin?: Skin;
  /** The kiosk's software update, shown on the kiosk only. */
  kioskUpdate?: KioskUpdate;
  /** Where the last save of countdown-server's config stands: a Saved tick, or a message when it didn't save. */
  saveStatus?: SaveStatus;
  /** Called each time the settings come up, to get countdown-server's config again. */
  onShow?: () => void;
  /** countdown-server's config once someone owns the kiosk, which the General and Countdown pages show and change. */
  deviceConfig?: TouchscreenConfig | undefined;
  onDeviceConfigSave?: DeviceConfig['save'] | undefined;
}

/**
 * A small Saved tick once a change has saved, or a short message when one didn't (and was undone), floating in the
 * page's corner: the page has no header of its own, as the navigation already says which one it is.
 */
function SaveNote({ status }: Readonly<{ status: SaveStatus }>) {
  return (
    <p className="settings-save-note" aria-live="polite">
      {status === 'saved' && (
        <span className="settings-status status-success">
          <Check className="settings-status-icon" aria-hidden="true" />
          Saved
        </span>
      )}
      {status === 'failed' && <span className="settings-status status-warning">Not saved</span>}
    </p>
  );
}

/** The Settings tab: the sections on the left and the chosen one's page on the right. */
export default function SettingsPanel({
  initialSection = 'overview',
  authInfo,
  signInError = null,
  onReload = reloadSettings,
  screenSleep,
  onScreenSleepChange,
  themeColour,
  onThemeColourChange,
  dashboardLayout,
  onDashboardLayoutChange,
  theme,
  autoTheme = false,
  onThemeChange,
  skin,
  kioskUpdate,
  saveStatus = 'idle',
  onShow,
  deviceConfig,
  onDeviceConfigSave
}: Readonly<SettingsPanelProps>) {
  const [kiosk] = useState(isKiosk);
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const wifi = useWifi(kiosk);
  const update = kiosk ? kioskUpdate : undefined;
  const authenticated = authInfo?.authenticated ?? false;
  // Screen sleep is the kiosk's only: a browser has no screen of its own to put to sleep.
  const hasSleep = kiosk && screenSleep !== undefined && onScreenSleepChange !== undefined;
  const owned = deviceConfig !== undefined && onDeviceConfigSave !== undefined;
  const sections = SETTINGS_SECTIONS.filter(
    choice =>
      (kiosk || !choice.kioskOnly) &&
      (choice.id !== 'general' || owned || hasSleep) &&
      (choice.id !== 'countdown' || owned)
  );
  const current = sections.find(choice => choice.id === section) ?? SETTINGS_SECTIONS[0];

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
    case 'appearance': {
      page = (
        <AppearanceSettings
          theme={theme}
          autoTheme={autoTheme}
          onThemeChange={onThemeChange}
          skin={skin}
          themeColour={themeColour}
          onThemeColourChange={onThemeColourChange}
          dashboardLayout={dashboardLayout}
          onDashboardLayoutChange={onDashboardLayoutChange}
        />
      );
      break;
    }
    case 'wifi': {
      page = <WifiSettings wifi={wifi} />;
      break;
    }
    case 'spotify': {
      page = <SpotifySettings authenticated={authenticated} signInError={signInError} onReload={onReload} />;
      break;
    }
    case 'about': {
      page = (
        <AboutSettings kioskUpdate={update} deviceConfig={owned ? deviceConfig : undefined} wifi={wifi} kiosk={kiosk} />
      );
      break;
    }
    default: {
      page = (
        <SettingsOverview
          onOpen={setSection}
          kiosk={kiosk}
          deviceConfig={owned ? deviceConfig : undefined}
          theme={theme}
          themeColour={themeColour}
          screenSleep={hasSleep ? screenSleep : undefined}
          wifi={wifi}
          authenticated={authenticated}
          kioskUpdate={update}
        />
      );
    }
  }

  return (
    <div className="app-modal-panel settings-panel settings-tab text-left select-none">
      <nav className="settings-nav" aria-label="Settings">
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
                <span className="truncate">{choice.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section className="settings-content" aria-label={current.label}>
        <SaveNote status={saveStatus} />
        {/* Keyed by the page, so each one starts scrolled to the top. */}
        <div className="settings-content-body" key={current.id}>
          {page}
        </div>
      </section>
    </div>
  );
}
