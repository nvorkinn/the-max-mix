import type { ReactNode } from 'react';
import {
  AlertCircle,
  ChevronRight,
  Info,
  MicVocal,
  Package,
  Palette,
  SlidersHorizontal,
  TrainFront,
  Wifi,
  WifiOff
} from 'lucide-react';
import type { TouchscreenConfig } from 'countdown-api';
import type { KioskUpdate } from '../../hooks/useKioskUpdate';
import SpotifyIcon from '../SpotifyIcon';
import type { SettingsSection } from './sections';
import { SOFTWARE_LOOK, softwareState } from './softwareStatus';
import type { WifiState } from './wifi';

/**
 * One page on the overview, by its icon and name; tapping it opens the page. A line under the name shows only when the
 * page needs looking at.
 */
function Card({
  icon,
  title,
  onOpen,
  line
}: Readonly<{ icon: ReactNode; title: string; onOpen: () => void; line?: ReactNode }>) {
  return (
    <button type="button" onClick={onOpen} className="settings-card">
      <span className="settings-box-icon">{icon}</span>
      <span className="settings-card-text">
        <span className="settings-box-title">{title}</span>
        {line !== undefined && <span className="settings-card-value">{line}</span>}
      </span>
      <ChevronRight className="settings-card-chevron" aria-hidden="true" />
    </button>
  );
}

/** A card's line about something that needs looking at, with an icon in the given tone. */
function Attention({
  icon: Icon = AlertCircle,
  tone = 'status-warning',
  spin = false,
  children
}: Readonly<{
  icon?: typeof AlertCircle;
  tone?: string;
  spin?: boolean | undefined;
  children: ReactNode;
}>) {
  return (
    <span className={`settings-status ${tone}`}>
      <Icon className={`settings-status-icon ${spin ? 'animate-spin' : ''}`} aria-hidden="true" />
      {children}
    </span>
  );
}

/** The Pi software's line, only while a newer version is out or one is being installed. */
function softwareAttention(update: KioskUpdate | undefined): ReactNode {
  if (!update) return undefined;
  const state = softwareState(update);
  if (state !== 'newer' && state !== 'updating') return undefined;
  const look = SOFTWARE_LOOK[state];
  return (
    <Attention icon={look.icon} tone={look.tone} spin={look.spin}>
      {state === 'updating' ? 'Updating' : update.newer}
    </Attention>
  );
}

/**
 * The settings' first page: a plain grid of the other pages, each by its icon and name. Only a page that needs looking at
 * says so under its name: Spotify not connected, the kiosk on no Wi-Fi, a newer Pi software out or being installed.
 */
export default function SettingsOverview({
  onOpen,
  kiosk,
  deviceConfig,
  hasGeneral,
  wifi,
  authenticated,
  kioskUpdate
}: Readonly<{
  onOpen: (section: SettingsSection) => void;
  kiosk: boolean;
  /** countdown-server's config, once someone owns the kiosk: the Countdown and Parcels cards show only then. */
  deviceConfig?: TouchscreenConfig | undefined;
  /** Whether there is a General page: once someone owns the kiosk, or on the kiosk itself (its screen sleep). */
  hasGeneral: boolean;
  wifi: WifiState;
  authenticated: boolean;
  kioskUpdate: KioskUpdate | undefined;
}>) {
  return (
    <div className="settings-overview" role="group" aria-label="Overview">
      {deviceConfig && (
        <Card
          icon={<TrainFront className="w-6 h-6" aria-hidden="true" />}
          title="Countdown"
          onOpen={() => onOpen('countdown')}
        />
      )}
      {hasGeneral && (
        <Card
          icon={<SlidersHorizontal className="w-6 h-6" aria-hidden="true" />}
          title="General"
          onOpen={() => onOpen('general')}
        />
      )}
      {deviceConfig && (
        <Card
          icon={<Package className="w-6 h-6" aria-hidden="true" />}
          title="Parcels"
          onOpen={() => onOpen('parcels')}
        />
      )}
      <Card
        icon={<Palette className="w-6 h-6" aria-hidden="true" />}
        title="Appearance"
        onOpen={() => onOpen('appearance')}
      />
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
          line={wifi.state === 'disconnected' ? <Attention>Not connected</Attention> : undefined}
        />
      )}
      <Card
        icon={<SpotifyIcon className="w-6 h-6" />}
        title="Spotify"
        onOpen={() => onOpen('spotify')}
        line={authenticated ? undefined : <Attention>Not connected</Attention>}
      />
      <Card icon={<MicVocal className="w-6 h-6" aria-hidden="true" />} title="Lyrics" onOpen={() => onOpen('lyrics')} />
      <Card
        icon={<Info className="w-6 h-6" aria-hidden="true" />}
        title="About"
        onOpen={() => onOpen('about')}
        line={softwareAttention(kioskUpdate)}
      />
    </div>
  );
}
