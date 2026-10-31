import { useState, useEffect } from 'react';
import { X, Speaker, Check, RefreshCw } from 'lucide-react';
import { getDevices } from '../spotify/api';
import type { AudioRoute } from '../spotify/settings';
import { errorMessage } from '../utils/errorMessage';
import type { SpotifyDevice } from '../types';
import AirPlaySpeakerList from './AirPlaySpeakerList';
import Modal from './Modal';

const ROUTES: { id: AudioRoute; label: string }[] = [
  { id: 'spotify-connect', label: 'Spotify Connect' },
  { id: 'airplay', label: 'AirPlay' }
];

function describeDevice(device: SpotifyDevice) {
  if (device.is_restricted) return 'Playback control restricted';
  const volume = device.volume_percent == null ? '' : ` / ${device.volume_percent}% volume`;
  return `${device.type || 'Device'}${volume}`;
}

export default function SpeakerSelectorModal({
  isOpen,
  onClose,
  onSelectSpeaker,
  browserDeviceId,
  isDemoMode,
  canUseAirPlay = false,
  audioRoute = 'spotify-connect',
  onAudioRouteChange
}: Readonly<{
  isOpen: boolean;
  onClose: () => void;
  onSelectSpeaker: (deviceId: string) => Promise<unknown>;
  browserDeviceId?: string | null;
  isDemoMode?: boolean;
  /** The Pi kiosk, whose audio service can send this tablet's sound to AirPlay speakers. */
  canUseAirPlay?: boolean;
  audioRoute?: AudioRoute;
  onAudioRouteChange?: (route: AudioRoute) => Promise<unknown>;
}>) {
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDevices = async () => {
    setLoading(true);
    try {
      const data = await getDevices();
      setDevices(data.devices);
      setError(null);
    } catch (caught) {
      setDevices([]);
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };
  const isAirPlay = canUseAirPlay && audioRoute === 'airplay';
  useEffect(() => {
    if (isOpen && !isAirPlay) void fetchDevices();
  }, [isOpen, browserDeviceId, isAirPlay]);

  if (!isOpen) return null;
  const changeRoute = async (route: AudioRoute) => {
    if (route === audioRoute || !onAudioRouteChange) return;
    setSelecting(true);
    try {
      await onAudioRouteChange(route);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSelecting(false);
    }
  };
  const selectDevice = async (deviceId: string) => {
    setSelecting(true);
    try {
      await onSelectSpeaker(deviceId);
      await fetchDevices();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSelecting(false);
    }
  };

  return (
    <Modal
      labelledBy="speakers-title"
      onClose={onClose}
      className="app-modal-panel border rounded-3xl p-6 max-w-md shadow-2xl"
    >
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/10">
        <div>
          <h2 id="speakers-title" className="text-base font-semibold">
            {isAirPlay ? 'Choose AirPlay speakers' : 'Choose a Spotify device'}
          </h2>
          <p className="text-xs text-neutral-400 mt-1">
            {isDemoMode && 'Simulated device / demo mode'}
            {!isDemoMode && (isAirPlay ? 'Speakers found on this network' : 'Devices reported by your Spotify account')}
          </p>
        </div>
        <div className="flex gap-2">
          {!isAirPlay && (
            <button
              type="button"
              onClick={() => void fetchDevices()}
              disabled={loading || selecting}
              aria-label="Refresh devices"
              className="p-2 rounded-full bg-white/5"
            >
              <RefreshCw size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            data-modal-autofocus
            aria-label="Close speakers"
            className="p-2 rounded-full bg-white/10"
          >
            <X size={18} />
          </button>
        </div>
      </div>
      {canUseAirPlay && (
        <div role="group" aria-label="Playback mode" className="mt-4 grid grid-cols-2 gap-1 p-1 rounded-xl bg-white/5">
          {ROUTES.map(route => (
            <button
              type="button"
              key={route.id}
              aria-pressed={audioRoute === route.id}
              disabled={selecting}
              onClick={() => void changeRoute(route.id)}
              className={`py-2 rounded-lg text-xs font-semibold ${
                audioRoute === route.id ? 'bg-[#d5f580] text-black' : 'text-neutral-300 hover:bg-white/10'
              }`}
            >
              {route.label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-rose-300 my-4">
          {error}
        </p>
      )}
      {isAirPlay ? (
        <AirPlaySpeakerList isPlayerReady={Boolean(browserDeviceId)} />
      ) : (
        <div className="mt-4 space-y-2">
          {!loading && !error && devices.length === 0 && (
            <p className="text-xs leading-relaxed text-neutral-400 py-6">
              No available devices. Open Spotify on a phone, computer, or Spotify Connect speaker, then refresh.
              {canUseAirPlay
                ? ' For AirPlay speakers such as Sonos, switch to AirPlay above.'
                : ' Bluetooth and AirPlay outputs are selected in Spotify or the operating system, not discovered directly by this app.'}
            </p>
          )}
          {devices.map(device => (
            <button
              type="button"
              key={device.id || device.name}
              disabled={!device.id || device.is_restricted || selecting}
              onClick={() => void selectDevice(device.id)}
              className="w-full p-3 flex gap-3 items-center text-left rounded-xl border border-white/10 bg-white/5 hover:bg-white/10"
            >
              <Speaker size={20} className="shrink-0 text-[#d5f580]" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm truncate">{device.name}</span>
                <span className="text-[11px] text-neutral-400">{describeDevice(device)}</span>
              </span>
              {device.is_active && (
                <span className="text-xs text-[#d5f580] flex items-center gap-1">
                  <Check size={14} /> Active
                </span>
              )}
            </button>
          ))}
          {browserDeviceId && devices.every(device => device.id !== browserDeviceId) && (
            <button
              type="button"
              disabled={selecting}
              className="button button-primary w-full"
              onClick={() => void selectDevice(browserDeviceId)}
            >
              Use this tablet
            </button>
          )}
        </div>
      )}
      <p className="text-[11px] text-neutral-400 border-t border-white/10 pt-3 mt-4">
        {isAirPlay
          ? 'AirPlay speakers lag the screen by about half a second.'
          : 'Selection transfers playback without automatically starting music. Press Play when ready.'}
      </p>
    </Modal>
  );
}
