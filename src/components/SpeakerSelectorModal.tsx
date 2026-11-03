import { useState, useEffect, useCallback } from 'react';
import { X, Speaker, Check, RefreshCw } from 'lucide-react';
import { getDevices } from '../spotify/api';
import { useSpotifyCooldown } from '../hooks/useSpotifyCooldown';
import { recordSpotifyRetryAfter, SpotifyApiError } from '../spotify/http';
import type { AudioRoute } from '../spotify/settings';
import { errorMessage } from '../utils/errorMessage';
import type { SpotifyDevice } from '../types';
import AirPlaySpeakerList from './AirPlaySpeakerList';
import Modal from './Modal';

function describeDevice(device: SpotifyDevice) {
  if (!device.id) return 'Not available to select from this app';
  if (device.is_restricted) return 'Playback control restricted';
  const volume = device.volume_percent == null ? '' : ` / ${device.volume_percent}% volume`;
  return `${device.type || 'Device'}${volume}`;
}

export default function SpeakerSelectorModal({
  isOpen,
  onClose,
  onSelectSpeaker,
  browserDeviceId,
  canUseAirPlay = false,
  audioRoute = 'spotify-connect',
  onAirPlayChange
}: Readonly<{
  isOpen: boolean;
  onClose: () => void;
  /** Plays on this tablet (its own device id) or on a Spotify Connect speaker. */
  onSelectSpeaker: (deviceId: string) => Promise<unknown>;
  browserDeviceId?: string | null;
  /** The Pi kiosk, whose audio service can send this tablet's sound to AirPlay speakers. */
  canUseAirPlay?: boolean;
  audioRoute?: AudioRoute;
  /** The AirPlay speakers now chosen; none means AirPlay is off. */
  onAirPlayChange?: (speakers: string[]) => Promise<unknown>;
}>) {
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const connectDevices = devices.filter(device => !browserDeviceId || device.id !== browserDeviceId);
  const tabletIsActive = !isAirPlay && devices.some(device => device.id === browserDeviceId && device.is_active);

  return (
    <Modal
      labelledBy="speakers-title"
      onClose={onClose}
      className="app-modal-panel border rounded-3xl p-6 max-w-md shadow-2xl"
    >
      <div className="modal-header modal-divider flex items-center justify-between gap-3 pb-3 border-b">
        <h2 id="speakers-title" className="text-base font-semibold">
          Speakers
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void fetchDevices()}
            disabled={loading || selecting || waitingForSpotify}
            aria-label="Refresh devices"
            className="modal-icon-button p-2 rounded-full"
          >
            <RefreshCw size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            data-modal-autofocus
            aria-label="Close speakers"
            className="modal-icon-button p-2 rounded-full"
          >
            <X size={18} />
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs status-danger my-4">
          {error}
        </p>
      )}
      {waitingForSpotify && (
        <p role="status" className="text-xs text-muted my-4">
          Spotify asked this app to wait before refreshing devices.
        </p>
      )}
      <div className="mt-4 space-y-2">
        {browserDeviceId && (
          <button
            type="button"
            disabled={selecting || waitingForSpotify}
            aria-pressed={tabletIsActive}
            onClick={() => void selectDevice(browserDeviceId)}
            className="modal-option w-full p-3 flex gap-3 items-center text-left rounded-xl border"
          >
            <Speaker size={20} className="shrink-0 text-accent" />
            <span className="flex-1 min-w-0 text-sm truncate">This tablet</span>
            {tabletIsActive && (
              <span className="text-xs text-accent flex items-center gap-1">
                <Check size={14} /> Active
              </span>
            )}
          </button>
        )}
        {canUseAirPlay && (
          <section aria-labelledby="airplay-title" className="space-y-2 pt-2">
            <h3 id="airplay-title" className="text-xs font-bold">
              AirPlay
            </h3>
            <p className="text-[11px] text-muted">Pick several. Plays from this tablet, a little behind the screen.</p>
            <AirPlaySpeakerList
              isPlayerReady={Boolean(browserDeviceId)}
              active={isAirPlay}
              onChange={onAirPlayChange}
            />
          </section>
        )}
        <section aria-labelledby="connect-title" className="space-y-2 pt-2">
          <h3 id="connect-title" className="text-xs font-bold">
            Spotify Connect
          </h3>
          <p className="text-[11px] text-muted">Plays on one speaker, even when this tablet is off.</p>
          {!loading && !error && connectDevices.length === 0 && (
            <p className="text-xs leading-relaxed text-muted py-2">
              No Spotify speakers found. Open Spotify on a phone, computer, or Connect speaker, then refresh.
            </p>
          )}
          {connectDevices.map(device => (
            <button
              type="button"
              key={device.id ?? `unavailable:${device.name}`}
              disabled={!device.id || device.is_restricted || selecting || waitingForSpotify}
              aria-pressed={!isAirPlay && Boolean(device.is_active)}
              onClick={() => device.id && void selectDevice(device.id)}
              className="modal-option w-full p-3 flex gap-3 items-center text-left rounded-xl border"
            >
              <Speaker size={20} className="shrink-0 text-accent" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm truncate">{device.name}</span>
                <span className="text-[11px] text-muted">{describeDevice(device)}</span>
              </span>
              {!isAirPlay && device.is_active && (
                <span className="text-xs text-accent flex items-center gap-1">
                  <Check size={14} /> Active
                </span>
              )}
            </button>
          ))}
          {!loading && !error && (
            <p className="text-[11px] leading-relaxed text-muted">
              Sonos and other Connect speakers show up here only after they have recently played through Spotify. Play
              to one from the Spotify app on your phone, then refresh.
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}
