import type { CSSProperties, ReactNode } from 'react';
import { AlertCircle, CheckCircle2, ChevronRight, Cpu, Music, Palette, Wifi, WifiOff } from 'lucide-react';
import type { KioskUpdate } from '../../hooks/useKioskUpdate';
import type { ScreenSleepMinutes } from '../../utils/screenSleep';
import { THEMES } from '../../utils/theme';
import type { Theme } from '../../utils/theme';
import { THEME_COLOURS } from '../../utils/themeColour';
import type { ThemeColour } from '../../utils/themeColour';
import SleepIcon from '../SleepIcon';
import { APP_VERSION } from './appVersion';
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

export default function SettingsOverview({
  onOpen,
  kiosk,
  theme,
  themeColour,
  screenSleep,
  wifi,
  authenticated,
  kioskUpdate
}: Readonly<{
  onOpen: (section: SettingsSection) => void;
  kiosk: boolean;
  theme: Theme | undefined;
  themeColour: ThemeColour | undefined;
  screenSleep: ScreenSleepMinutes | undefined;
  wifi: WifiState;
  authenticated: boolean;
  kioskUpdate: KioskUpdate | undefined;
}>) {
  const colour = THEME_COLOURS.find(choice => choice.id === themeColour);
  const themeName = THEMES.find(choice => choice.id === theme)?.label;
  const network = wifiLabel(wifi);

  return (
    <div className="settings-overview" role="group" aria-labelledby="settings-section-title">
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
      </Card>
      {kiosk && screenSleep !== undefined && (
        <Card icon={<SleepIcon className="w-6 h-6" />} title="Screen sleep" onOpen={() => onOpen('sleep')}>
          {screenSleep === 0 ? 'Never' : `After ${screenSleep} minutes`}
        </Card>
      )}
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
      <Card icon={<Music className="w-6 h-6" aria-hidden="true" />} title="Spotify" onOpen={() => onOpen('spotify')}>
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
      <Card
        icon={<Cpu className="w-6 h-6" aria-hidden="true" />}
        title="Software"
        wide
        onOpen={() => onOpen('software')}
      >
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
