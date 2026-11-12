import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Speaker, Check, RefreshCw, SlidersHorizontal, Airplay, Bluetooth } from 'lucide-react';
import { getDevices } from '../spotify/api';
import { getKnownSpeakers } from '../spotify/knownDevices';
import { useSpotifyCooldown } from '../hooks/useSpotifyCooldown';
import { recordSpotifyRetryAfter, SpotifyApiError } from '../spotify/http';
import type { AudioRoute } from '../spotify/settings';
import { errorMessage } from '../utils/errorMessage';
import type { SpotifyDevice } from '../types';
import AirPlaySpeakerList from './AirPlaySpeakerList';
import BluetoothSpeakers from './BluetoothSpeakers';
import SonosKioskList from './SonosKioskList';

/** `remembered`: Spotify did not list it, but the app has seen it playing. */
function describeDevice(device: SpotifyDevice, remembered: boolean) {
  if (remembered) return `${device.type || 'Device'} / seen playing before`;
  if (!device.id) return 'Not available to select from this app';
  if (device.is_restricted) return 'Playback control restricted';
  const volume = device.volume_percent == null ? '' : ` / ${device.volume_percent}% volume`;
  return `${device.type || 'Device'}${volume}`;
}

const TABS = [
  { id: 'connect', label: 'Spotify Connect', Icon: Speaker },
  { id: 'airplay', label: 'AirPlay', Icon: Airplay },
  { id: 'bluetooth', label: 'Bluetooth', Icon: Bluetooth }
] as const;

/**
 * The speakers drawer: opens above the device indicator in the control bar. It lists the Spotify Connect devices (the
 * one that is playing first) and, on the kiosk, the Sonos rooms the Pi finds. On the kiosk three icon tabs switch
 * between Spotify Connect, AirPlay and Bluetooth. AirPlay and Bluetooth play what this tablet plays, so their tabs only
 * open while this tablet is the one playing (or AirPlay is already on).
 */
export default function SpeakerDrawer({
  isOpen,
  onClose,
  onSelectSpeaker,
  browserDeviceId,
  activeDeviceId,
  canUseAirPlay = false,
  audioRoute = 'spotify-connect',
  onAirPlayChange,
  onPlayOnSonos
}: Readonly<{
  isOpen: boolean;
  onClose: () => void;
  /** Plays on this tablet (its own device id) or on a Spotify Connect speaker. */
  onSelectSpeaker: (deviceId: string) => Promise<unknown>;
  browserDeviceId?: string | null;
  /** The Spotify Connect device that is playing right now. */
  activeDeviceId?: string | null;
  /** The Pi kiosk, whose audio service can send this tablet's sound to AirPlay speakers. */
  canUseAirPlay?: boolean;
  audioRoute?: AudioRoute;
  /** The AirPlay speakers now chosen; none means AirPlay is off. */
  onAirPlayChange?: (speakers: string[]) => unknown;
  /** The kiosk: plays the song on screen on a Sonos room through the Pi, instead of Spotify Connect. */
  onPlayOnSonos?: ((room: string) => Promise<void>) | undefined;
}>) {
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The Sonos rooms listed below the Connect devices; a Connect device of the same name is that speaker, shown once.
  // Each speaker's own volume is hidden until asked for: the main volume slider is the one to use.
  const [showVolumes, setShowVolumes] = useState(false);
  const [sonosRooms, setSonosRooms] = useState<readonly string[]>([]);
  type SpeakerTab = (typeof TABS)[number]['id'];
  // The tab picked since the drawer opened; none means the one that fits where the sound goes now.
  const [pickedTab, setPickedTab] = useState<SpeakerTab | null>(null);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    setPickedTab(null);
  }
  const retryAt = useSpotifyCooldown();
  const waitingForSpotify = retryAt > 0;
  const reportError = useCallback((caught: unknown) => {
    if (caught instanceof SpotifyApiError) recordSpotifyRetryAfter(caught);
    setError(errorMessage(caught));
  }, []);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getDevices();
      setDevices(data.devices);
      setError(null);
    } catch (caught) {
      setDevices([]);
      reportError(caught);
    } finally {
      setLoading(false);
    }
  }, [reportError]);
  const isAirPlay = canUseAirPlay && audioRoute === 'airplay';
  useEffect(() => {
    if (isOpen) void fetchDevices();
  }, [isOpen, browserDeviceId, fetchDevices]);

  const drawerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  // Focus moves into the drawer while it is open and goes back to what opened it. Escape closes it.
  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement;
    drawerRef.current?.querySelector<HTMLElement>('[data-modal-autofocus]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;
  const selectDevice = async (deviceId: string) => {
    setSelecting(true);
    try {
      await onSelectSpeaker(deviceId);
      await fetchDevices();
    } catch (caught) {
      reportError(caught);
    } finally {
      setSelecting(false);
    }
  };

  // Spotify's list leaves out some speakers (Sonos among them), even while they play; the ones seen playing are added.
  const listed = new Set(devices.flatMap(device => [device.id, device.name.toLowerCase()]));
  const extra = getKnownSpeakers().filter(device => !listed.has(device.id) && !listed.has(device.name.toLowerCase()));
  const rememberedIds = new Set(extra.map(device => device.id));
  const allDevices = [...devices, ...extra];
  const hasSonos = Boolean(onPlayOnSonos);
  const sonosNames = new Set(hasSonos ? sonosRooms.map(name => name.toLowerCase()) : []);
  const connectDevices = allDevices.filter(
    device => (!browserDeviceId || device.id !== browserDeviceId) && !sonosNames.has(device.name.toLowerCase())
  );
  const playingId = activeDeviceId ?? devices.find(device => device.is_active)?.id;
  const tabletIsActive = Boolean(browserDeviceId) && !isAirPlay && playingId === browserDeviceId;
  // AirPlay sends this tablet's own sound on, so it needs the tablet to be the one playing (or AirPlay to be on already).
  const airPlayAvailable = Boolean(browserDeviceId) && (tabletIsActive || isAirPlay);
  // A saved AirPlay route keeps its tab open even without a player, so its speakers can still be cleared.
  const otherTabsEnabled = airPlayAvailable || isAirPlay;
  let tab: SpeakerTab = pickedTab ?? (isAirPlay ? 'airplay' : 'connect');
  if (!canUseAirPlay || !otherTabsEnabled) tab = 'connect';
  // Every tab's panel stays mounted, stacked in one grid cell, so the drawer keeps the height of the tallest one and
  // nothing reloads (and resizes the drawer) on a tab change. The hidden ones are invisible and out of reach.
  const panelProps = (id: SpeakerTab) => (tab === id ? {} : { 'aria-hidden': true, inert: true });
  const panelClass = (id: SpeakerTab, layout = '') => [layout, tab === id ? '' : 'invisible'].filter(Boolean).join(' ');
  // The device that is playing is listed first.
  const isPlaying = (device: SpotifyDevice) => !isAirPlay && Boolean(device.id) && device.id === playingId;
  const tabletRow = browserDeviceId && (
    <button
      type="button"
      key={browserDeviceId}
      disabled={selecting || waitingForSpotify}
      aria-pressed={tabletIsActive}
      onClick={() => void selectDevice(browserDeviceId)}
      className="modal-option w-full px-3 py-2 flex gap-3 items-center text-left rounded-xl border"
    >
      <Speaker size={20} className="shrink-0 text-accent" />
      <span className="flex-1 min-w-0 text-sm truncate">This tablet</span>
      {tabletIsActive && (
        <span className="text-xs text-accent flex items-center gap-1">
          <Check size={14} /> Playing
        </span>
      )}
    </button>
  );
  const deviceRows = connectDevices.map(device => ({
    playing: isPlaying(device),
    node: (
      <button
        type="button"
        key={device.id ?? `unavailable:${device.name}`}
        disabled={!device.id || device.is_restricted || selecting || waitingForSpotify}
        aria-pressed={isPlaying(device)}
        onClick={() => device.id && void selectDevice(device.id)}
        className="modal-option w-full px-3 py-2 flex gap-3 items-center text-left rounded-xl border"
      >
        <Speaker size={20} className="shrink-0 text-accent" />
        <span className="flex-1 min-w-0">
          <span className="block text-sm truncate">{device.name}</span>
          <span className="text-[11px] text-muted">{describeDevice(device, rememberedIds.has(device.id))}</span>
        </span>
        {isPlaying(device) && (
          <span className="text-xs text-accent flex items-center gap-1">
            <Check size={14} /> Playing
          </span>
        )}
      </button>
    )
  }));
  // This tablet comes before the other devices, and whichever one is playing comes before all of them.
  const rows = [...(tabletRow ? [{ playing: tabletIsActive, node: tabletRow }] : []), ...deviceRows]
    .toSorted((a, b) => Number(b.playing) - Number(a.playing))
    .map(row => row.node);

  return (
    <>
      <button type="button" className="speaker-scrim" tabIndex={-1} aria-hidden="true" onClick={onClose} />
      <div ref={drawerRef} role="dialog" aria-labelledby="speakers-title" className="speaker-drawer app-modal-panel">
        <div className="flex items-center justify-between gap-3">
          <h2 id="speakers-title" className="text-base font-semibold">
            Speakers
          </h2>
          <div className="flex gap-2">
            {tab === 'airplay' && (
              <button
                type="button"
                onClick={() => setShowVolumes(shown => !shown)}
                aria-pressed={showVolumes}
                aria-label="Show each speaker's volume"
                title="Each speaker's volume"
                className="modal-icon-button w-11 h-11 rounded-full flex items-center justify-center"
              >
                <SlidersHorizontal size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={() => void fetchDevices()}
              disabled={loading || selecting || waitingForSpotify}
              aria-label="Refresh devices"
              className="modal-icon-button w-11 h-11 rounded-full flex items-center justify-center"
            >
              <RefreshCw size={16} />
            </button>
            <button
              type="button"
              onClick={onClose}
              data-modal-autofocus
              aria-label="Close speakers"
              className="modal-icon-button w-11 h-11 rounded-full flex items-center justify-center"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        {canUseAirPlay && (
          <div className="flex gap-1.5" role="group" aria-label="Kind of speaker">
            {TABS.map(({ id, label, Icon }) => (
              <button
                type="button"
                key={id}
                aria-label={label}
                title={label}
                aria-pressed={tab === id}
                disabled={id !== 'connect' && !otherTabsEnabled}
                onClick={() => setPickedTab(id)}
                className="modal-option flex-1 min-h-11 rounded-xl border flex items-center justify-center"
              >
                <Icon size={20} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        <div className="speaker-drawer-body space-y-2">
          {error && (
            <p role="alert" className="text-xs status-danger">
              {error}
            </p>
          )}
          {waitingForSpotify && (
            <p role="status" className="text-xs text-muted">
              Spotify asked this app to wait before refreshing devices.
            </p>
          )}
          <div className="speaker-tab-panels">
            <section
              aria-label="Spotify Connect"
              {...panelProps('connect')}
              className={panelClass('connect', 'grid gap-2')}
            >
              {rows}
              {onPlayOnSonos && (
                <SonosKioskList disabled={selecting} onPlayOnSonos={onPlayOnSonos} onRooms={setSonosRooms} />
              )}
              {canUseAirPlay && !otherTabsEnabled && (
                <p className="text-[11px] leading-relaxed text-muted">
                  {browserDeviceId
                    ? 'Choose This tablet to use AirPlay or Bluetooth.'
                    : "This tablet's player isn't ready, so AirPlay and Bluetooth can't be used yet."}
                </p>
              )}
              {!loading && !error && connectDevices.length === 0 && !hasSonos && (
                <p className="text-xs leading-relaxed text-muted py-2">
                  No Spotify speakers found. Open Spotify on a phone, computer, or Connect speaker, then refresh.
                </p>
              )}
            </section>
            {canUseAirPlay && (
              <>
                <section aria-label="AirPlay" {...panelProps('airplay')} className={panelClass('airplay')}>
                  <AirPlaySpeakerList
                    isPlayerReady={airPlayAvailable}
                    active={isAirPlay}
                    showVolumes={showVolumes}
                    onChange={onAirPlayChange}
                  />
                </section>
                <section
                  aria-label="Bluetooth"
                  {...panelProps('bluetooth')}
                  className={panelClass('bluetooth', 'space-y-2')}
                >
                  <p className="text-[11px] text-muted">
                    One speaker at a time. Once connected, it appears on the AirPlay tab to select.
                  </p>
                  <BluetoothSpeakers />
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
