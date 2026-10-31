import { useState, useEffect, useCallback } from 'react';
import { Check, RefreshCw, Speaker } from 'lucide-react';
import { getAirPlayStatus, setAirPlaySpeakers } from '../audio/airplay';
import type { AirPlayStatus } from '../audio/airplay';
import { errorMessage } from '../utils/errorMessage';

// PipeWire finds speakers over mDNS a few seconds after they appear, so the list is read again while it is open.
const REFRESH_MS = 5000;

/** The AirPlay speakers the Pi found; each tap adds or removes one, and every chosen speaker plays at once. */
export default function AirPlaySpeakerList({ isPlayerReady }: Readonly<{ isPlayerReady: boolean }>) {
  const [status, setStatus] = useState<AirPlayStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await getAirPlayStatus());
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const toggle = async (id: string) => {
    const selected = status?.selected ?? [];
    const next = selected.includes(id) ? selected.filter(other => other !== id) : [...selected, id];
    setSaving(true);
    try {
      setStatus(await setAirPlaySpeakers(next));
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const speakers = status?.speakers ?? [];
  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-neutral-400">
          This tablet plays, and the sound goes to every speaker you pick. Tap a speaker to add or remove it.
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || saving}
          aria-label="Refresh AirPlay speakers"
          className="p-2 rounded-full bg-white/5 shrink-0"
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {!isPlayerReady && (
        <p role="status" className="text-xs text-amber-300">
          The tablet&apos;s Spotify player is not ready. Turn on &quot;Play in this browser&quot; in Settings and sign
          in to Spotify.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      )}
      {status && speakers.length === 0 && (
        <p className="text-xs leading-relaxed text-neutral-400 py-4">
          Looking for AirPlay speakers on this network. Sonos speakers show up once AirPlay is on in the Sonos app.
        </p>
      )}
      {speakers.map(speaker => (
        <button
          type="button"
          key={speaker.id}
          aria-pressed={speaker.selected}
          disabled={saving || !isPlayerReady}
          onClick={() => void toggle(speaker.id)}
          className={`w-full p-3 flex gap-3 items-center text-left rounded-xl border hover:bg-white/10 ${
            speaker.selected ? 'border-[#d5f580]/60 bg-white/10' : 'border-white/10 bg-white/5'
          }`}
        >
          <Speaker size={20} className="shrink-0 text-[#d5f580]" />
          <span className="flex-1 min-w-0 text-sm truncate">{speaker.name}</span>
          {speaker.selected && (
            <span className="text-xs text-[#d5f580] flex items-center gap-1">
              <Check size={14} /> Playing here
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
