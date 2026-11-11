import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Speaker, Check, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { isSonosSignedIn } from '../sonos/auth';
import { getDevices } from '../spotify/api';
import { getKnownSpeakers } from '../spotify/knownDevices';
import { useSpotifyCooldown } from '../hooks/useSpotifyCooldown';
import { recordSpotifyRetryAfter, SpotifyApiError } from '../spotify/http';
import type { AudioRoute } from '../spotify/settings';
import { errorMessage } from '../utils/errorMessage';
import type { SpotifyDevice } from '../types';
import AirPlaySpeakerList from './AirPlaySpeakerList';
import BluetoothSpeakers from './BluetoothSpeakers';
import SonosGroupList from './SonosGroupList';

/** `remembered`: Spotify did not list it, but the app has seen it playing. */
function describeDevice(device: SpotifyDevice, remembered: boolean) {
  if (remembered) return `${device.type || 'Device'} / seen playing before`;
  if (!device.id) return 'Not available to select from this app';
  if (device.is_restricted) return 'Playback control restricted';
  const volume = device.volume_percent == null ? '' : ` / ${device.volume_percent}% volume`;
  return `${device.type || 'Device'}${volume}`;
}

/**
 * The speakers drawer: opens above the device indicator in the control bar. It lists the Spotify Connect devices (the
 * one that is playing first), the Sonos groups when signed in to Sonos, and, on the kiosk, the AirPlay speakers. AirPlay plays what this tablet plays, so its
 * speakers can only be picked while this tablet is the one playing.
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
  /** The kiosk: plays the song on screen on a Sonos room through the Pi (sonoscli), instead of Spotify Connect. */
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
  const sonosSignedIn = isSonosSignedIn();
  const sonosNames = new Set(sonosSignedIn ? sonosRooms.map(name => name.toLowerCase()) : []);
  const connectDevices = allDevices.filter(
    device => (!browserDeviceId || device.id !== browserDeviceId) && !sonosNames.has(device.name.toLowerCase())
  );
  const playingId = activeDeviceId ?? devices.find(device => device.is_active)?.id;
  const tabletIsActive = Boolean(browserDeviceId) && !isAirPlay && playingId === browserDeviceId;
  // AirPlay sends this tablet's own sound on, so it needs the tablet to be the one playing (or AirPlay to be on already).
  const airPlayAvailable = Boolean(browserDeviceId) && (tabletIsActive || isAirPlay);
  // The device that is playing is listed first.
  const isPlaying = (device: SpotifyDevice) => !isAirPlay && Boolean(device.id) && device.id === playingId;
  const tabletRow = browserDeviceId && (
    <button
      type="button"
      key={browserDeviceId}
      disabled={selecting || waitingForSpotify}
      aria-pressed={tabletIsActive}
      onClick={() => void selectDevice(browserDeviceId)}
      className="modal-option w-full p-3 flex gap-3 items-center text-left rounded-xl border"
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
        className="modal-option w-full p-3 flex gap-3 items-center text-left rounded-xl border"
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
          <section aria-labelledby="connect-title" className="space-y-2">
            <h3 id="connect-title" className="text-xs font-bold">
              {sonosSignedIn ? 'Spotify Connect and Sonos' : 'Spotify Connect'}
            </h3>
            <p className="text-[11px] text-muted">
              Plays on one speaker at a time, even when this tablet is off. The music moves there.
            </p>
            {rows}
            {sonosSignedIn && (
              <SonosGroupList
                devices={allDevices}
                playingId={isAirPlay ? null : playingId}
                disabled={selecting || waitingForSpotify}
                onSelect={selectDevice}
                onPlayOnSonos={onPlayOnSonos}
                onRooms={setSonosRooms}
                showVolumes={showVolumes}
              />
            )}
            {!loading && !error && connectDevices.length === 0 && !sonosSignedIn && (
              <p className="text-xs leading-relaxed text-muted py-2">
                No Spotify speakers found. Open Spotify on a phone, computer, or Connect speaker, then refresh.
              </p>
            )}
            {!loading && !error && !sonosSignedIn && (
              <p className="text-[11px] leading-relaxed text-muted">
                Sonos and other Connect speakers show up here only after they have recently played through Spotify. Play
                to one from the Spotify app on your phone, then refresh.
              </p>
            )}
          </section>
          {canUseAirPlay && (
            <section aria-labelledby="airplay-title" className="space-y-2 pt-2">
              <h3 id="airplay-title" className="text-xs font-bold">
                AirPlay
              </h3>
              <p className="text-[11px] text-muted">
                Pick several. Plays from this tablet, a little behind the screen.
              </p>
              <AirPlaySpeakerList
                isPlayerReady={airPlayAvailable}
                notReadyMessage={
                  browserDeviceId
                    ? 'Choose This tablet above to use AirPlay.'
                    : "This tablet's player isn't ready, so speakers can't be added yet."
                }
                active={isAirPlay}
                showVolumes={showVolumes}
                onChange={onAirPlayChange}
              />
            </section>
          )}
          {canUseAirPlay && (
            <section aria-labelledby="bluetooth-title" className="space-y-2 pt-2">
              <h3 id="bluetooth-title" className="text-xs font-bold">
                Bluetooth
              </h3>
              <p className="text-[11px] text-muted">
                One speaker at a time. Once connected, it appears in the list above to select.
              </p>
              <BluetoothSpeakers />
            </section>
          )}
        </div>
      </div>
    </>
  );
}
