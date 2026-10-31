import { useState, useEffect, useCallback } from 'react';
import { Check, Speaker } from 'lucide-react';
import {
  getChosenSpeakers,
  listAudioOutputs,
  routeAudio,
  setChosenSpeakers,
  watchAudioOutputs
} from '../audio/airplay';
import { errorMessage } from '../utils/errorMessage';

/**
 * The audio outputs Chromium sees (the Pi makes one for each AirPlay speaker it finds). Each tap adds or removes one,
 * and every chosen speaker plays at once.
 */
export default function AirPlaySpeakerList({ isPlayerReady }: Readonly<{ isPlayerReady: boolean }>) {
  const [outputs, setOutputs] = useState<string[] | null>(null);
  const [chosen, setChosen] = useState(getChosenSpeakers);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setOutputs(await listAudioOutputs());
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void refresh();
    return watchAudioOutputs(() => void refresh());
  }, [refresh]);

  const toggle = (name: string) => {
    const next = chosen.includes(name) ? chosen.filter(other => other !== name) : [...chosen, name];
    setChosen(next);
    setChosenSpeakers(next);
    routeAudio(next);
  };

  // Chosen speakers that are not on the network right now stay listed, so they can be removed.
  const names = [...new Set([...(outputs ?? []), ...chosen])];
  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs text-neutral-400">
        This tablet plays, and the sound goes to every speaker you pick. Tap a speaker to add or remove it.
      </p>
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
      {outputs && names.length === 0 && (
        <p className="text-xs leading-relaxed text-neutral-400 py-4">
          Looking for AirPlay speakers on this network. Sonos speakers show up once AirPlay is on in the Sonos app.
        </p>
      )}
      {names.map(name => {
        const isChosen = chosen.includes(name);
        const isPresent = outputs?.includes(name) ?? false;
        return (
          <button
            type="button"
            key={name}
            aria-pressed={isChosen}
            disabled={!isPlayerReady}
            onClick={() => toggle(name)}
            className={`w-full p-3 flex gap-3 items-center text-left rounded-xl border hover:bg-white/10 ${
              isChosen ? 'border-[#d5f580]/60 bg-white/10' : 'border-white/10 bg-white/5'
            }`}
          >
            <Speaker size={20} className="shrink-0 text-[#d5f580]" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm truncate">{name}</span>
              {!isPresent && <span className="text-[11px] text-neutral-400">Not on the network</span>}
            </span>
            {isChosen && (
              <span className="text-xs text-[#d5f580] flex items-center gap-1">
                <Check size={14} /> Playing here
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
