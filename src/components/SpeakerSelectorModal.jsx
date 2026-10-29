import { useState, useEffect } from 'react';
import { X, Speaker, Check, RefreshCw } from 'lucide-react';
import { getDevices } from '../spotify/api';

/** @param {import('../types').SpotifyDevice} device */
function describeDevice(device) {
  if (device.is_restricted) return 'Playback control restricted';
  const volume = device.volume_percent == null ? '' : ` / ${device.volume_percent}% volume`;
  return `${device.type || 'Device'}${volume}`;
}

/**
 * @param {{
 *   isOpen: boolean,
 *   onClose: () => void,
 *   onSelectSpeaker: (deviceId: string) => Promise<unknown>,
 *   browserDeviceId?: string | null,
 *   isDemoMode?: boolean
 * }} props
 */
export default function SpeakerSelectorModal({ isOpen, onClose, onSelectSpeaker, browserDeviceId, isDemoMode }) {
  const [devices, setDevices] = useState(/** @type {import('../types').SpotifyDevice[]} */ ([]));
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));

  const fetchDevices = async () => {
    setLoading(true);
    try {
      const data = await getDevices();
      setDevices(data.devices);
      setError(null);
    } catch (caught) {
      setDevices([]);
      setError(/** @type {Error} */ (caught).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (isOpen) void fetchDevices();
  }, [isOpen, browserDeviceId]);

  if (!isOpen) return null;
  /** @param {string} deviceId */
  const selectDevice = async deviceId => {
    setSelecting(true);
    try {
      await onSelectSpeaker(deviceId);
      await fetchDevices();
    } catch (caught) {
      setError(/** @type {Error} */ (caught).message);
    } finally {
      setSelecting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="speakers-title"
        className="app-modal-panel border rounded-3xl p-6 max-w-md w-full shadow-2xl max-h-[92dvh] overflow-y-auto"
      >
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/10">
          <div>
            <h2 id="speakers-title" className="text-base font-semibold">
              Choose a Spotify device
            </h2>
            <p className="text-xs text-neutral-400 mt-1">
              {isDemoMode ? 'Simulated device / demo mode' : 'Devices reported by your Spotify account'}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void fetchDevices()}
              disabled={loading || selecting}
              aria-label="Refresh devices"
              className="p-2 rounded-full bg-white/5"
            >
              <RefreshCw size={16} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close speakers"
              className="p-2 rounded-full bg-white/10"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-xs text-rose-300 my-4">
            {error}
          </p>
        )}
        <div className="mt-4 space-y-2">
          {!loading && !error && devices.length === 0 && (
            <p className="text-xs leading-relaxed text-neutral-400 py-6">
              No available devices. Open Spotify on a phone, computer, or Spotify Connect speaker, then refresh.
              Bluetooth and AirPlay outputs are selected in Spotify or the operating system, not discovered directly by
              this app.
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
        <p className="text-[11px] text-neutral-400 border-t border-white/10 pt-3 mt-4">
          Selection transfers playback without automatically starting music. Press Play when ready.
        </p>
      </div>
    </div>
  );
}
