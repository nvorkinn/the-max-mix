import type { CSSProperties, ReactNode } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Info,
  Palette,
  SlidersHorizontal,
  TrainFront,
  Wifi,
  WifiOff
} from 'lucide-react';
import type { TouchscreenConfig } from 'countdown-api';
import type { KioskUpdate } from '../../hooks/useKioskUpdate';
import type { ScreenSleepMinutes } from '../../utils/screenSleep';
import { THEMES } from '../../utils/theme';
import type { Theme } from '../../utils/theme';
import { THEME_COLOURS } from '../../utils/themeColour';
import type { ThemeColour } from '../../utils/themeColour';
import SpotifyIcon from '../SpotifyIcon';
import { APP_VERSION } from './appVersion';
import { noticeBoardLabel } from './NoticeBoardDialog';
import type { SettingsSection } from './sections';
import { SOFTWARE_LOOK, softwareState } from './softwareStatus';
import { wifiLabel } from './wifi';
import type { WifiState } from './wifi';

/** One summary on the overview; tapping it opens its page. */
function Card({
  icon,
  title,
  wide = false,
  onOpen,
  children
}: Readonly<{ icon: ReactNode; title: string; wide?: boolean; onOpen: () => void; children: ReactNode }>) {
  return (
    <button type="button" onClick={onOpen} className={`settings-card ${wide ? 'settings-card-wide' : ''}`}>
      <span className="settings-box-icon">{icon}</span>
      <span className="settings-card-text">
        <span className="settings-box-title">{title}</span>
        <span className="settings-card-value">{children}</span>
      </span>
      <ChevronRight className="settings-card-chevron" aria-hidden="true" />
    </button>
  );
}

/** Which version the Pi runs and whether a newer one is out, with the Software page's icon and colour. */
function PiSoftware({ update }: Readonly<{ update: KioskUpdate }>) {
  const state = softwareState(update);
  const look = SOFTWARE_LOOK[state];
  const Icon = look.icon;
  const words: Record<typeof state, string> = {
    checking: 'Checking for updates',
    updating: 'Updating',
    current: 'Up to date',
    newer: update.newer ?? '',
    unknown: update.version ? 'Could not check for updates' : 'Version unknown'
  };
  return (
    <>
      {update.version && (
        <span className="font-mono">{update.release ? update.version.ref : update.version.commit}</span>
      )}
      <span className={`settings-status ${look.tone}`}>
        <Icon className={`settings-status-icon ${look.spin ? 'animate-spin' : ''}`} aria-hidden="true" />
        {words[state]}
      </span>
    </>
  );
}

/** The General page in brief: the time format, the weather's place, the notice board's postcode and screen sleep. */
function GeneralSummary({
  config,
  screenSleep
}: Readonly<{ config: TouchscreenConfig | undefined; screenSleep: ScreenSleepMinutes | undefined }>) {
  const notices = config && noticeBoardLabel(config.notice_board);
  return (
    <>
      {config && <span>{config.clock_format === '12h' ? '12-hour' : '24-hour'}</span>}
      {config?.weather.key && <span className="truncate">{config.weather.location}</span>}
      {notices && <span className="truncate">{notices}</span>}
      {screenSleep !== undefined && (
        <span>{screenSleep === 0 ? 'Never sleeps' : `Sleeps after ${screenSleep} min`}</span>
      )}
    </>
  );
}

export default function SettingsOverview({
  onOpen,
  kiosk,
  deviceConfig,
  theme,
  themeColour,
  dynamicColour,
  screenSleep,
  wifi,
  authenticated,
  kioskUpdate
}: Readonly<{
  onOpen: (section: SettingsSection) => void;
  kiosk: boolean;
  /** countdown-server's config, once someone owns the kiosk: the Countdown card shows only then. */
  deviceConfig?: TouchscreenConfig | undefined;
  theme: Theme | undefined;
  themeColour: ThemeColour | undefined;
  dynamicColour?: boolean | undefined;
  screenSleep: ScreenSleepMinutes | undefined;
  wifi: WifiState;
  authenticated: boolean;
  kioskUpdate: KioskUpdate | undefined;
}>) {
  const colour = THEME_COLOURS.find(choice => choice.id === themeColour);
  const themeName = THEMES.find(choice => choice.id === theme)?.label;
  const network = wifiLabel(wifi);
  const stops = deviceConfig?.arrivals.stops.length ?? 0;

  return (
    <div className="settings-overview" role="group" aria-label="Overview">
      {deviceConfig && (
        <Card
          icon={<TrainFront className="w-6 h-6" aria-hidden="true" />}
          title="Countdown"
          wide
          onOpen={() => onOpen('countdown')}
        >
          <span>{stops === 1 ? '1 stop' : `${stops} stops`}</span>
        </Card>
      )}
      {(deviceConfig !== undefined || screenSleep !== undefined) && (
        <Card
          icon={<SlidersHorizontal className="w-6 h-6" aria-hidden="true" />}
          title="General"
          onOpen={() => onOpen('general')}
        >
          <GeneralSummary config={deviceConfig} screenSleep={screenSleep} />
        </Card>
      )}
      <Card
        icon={<Palette className="w-6 h-6" aria-hidden="true" />}
        title="Appearance"
        onOpen={() => onOpen('appearance')}
      >
        {themeName && <span>{themeName}</span>}
        {colour && (
          <span className="settings-status">
            <span className="settings-dot" style={{ '--swatch': colour.swatch } as CSSProperties} />
            {colour.label}
          </span>
        )}
        {dynamicColour && <span>Dynamic</span>}
      </Card>
      {kiosk && (
        <Card
          icon={
            wifi.state === 'disconnected' ? (
              <WifiOff className="w-6 h-6" aria-hidden="true" />
            ) : (
              <Wifi className="w-6 h-6" aria-hidden="true" />
            )
          }
          title="Wi-Fi"
          onOpen={() => onOpen('wifi')}
        >
          <span className={`truncate ${wifi.state === 'connected' ? '' : 'text-muted'}`}>{network ?? '\u{A0}'}</span>
        </Card>
      )}
      <Card icon={<SpotifyIcon className="w-6 h-6" />} title="Spotify" onOpen={() => onOpen('spotify')}>
        {authenticated ? (
          <span className="settings-status status-success">
            <CheckCircle2 className="settings-status-icon" aria-hidden="true" />
            Connected
          </span>
        ) : (
          <span className="settings-status status-warning">
            <AlertCircle className="settings-status-icon" aria-hidden="true" />
            Not connected
          </span>
        )}
      </Card>
      <Card icon={<Info className="w-6 h-6" aria-hidden="true" />} title="About" wide onOpen={() => onOpen('about')}>
        {kioskUpdate ? (
          <PiSoftware update={kioskUpdate} />
        ) : (
          <span>
            Version <span className="font-mono">{APP_VERSION}</span>
          </span>
        )}
      </Card>
    </div>
  );
}
