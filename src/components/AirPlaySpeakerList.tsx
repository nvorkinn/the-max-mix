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
 * requesting a route to the chosen speakers only when the player is ready. Saved choices can be removed before then.
 * Chromium cannot confirm playback on that route. While `active` is false (another speaker is playing) nothing counts as
 * chosen, and the next tap starts a new selection.
 */
export default function AirPlaySpeakerList({
  isPlayerReady,
  active = true,
  onChange
}: Readonly<{
  isPlayerReady: boolean;
  active?: boolean | undefined;
  /** Called with the speakers now chosen, after they were saved and (with a ready player) routed. */
  onChange?: ((speakers: string[]) => unknown) | undefined;
}>) {
  const [outputs, setOutputs] = useState<string[] | null>(null);
  const [chosen, setChosen] = useState(getChosenSpeakers);
  const [error, setError] = useState<string | null>(null);
  if (!active && chosen.length > 0) setChosen([]);

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
    const isChosen = chosen.includes(name);
    if (!isPlayerReady && !isChosen) return;
    const next = isChosen ? chosen.filter(other => other !== name) : [...chosen, name];
    setChosen(next);
    setChosenSpeakers(next);
    if (isPlayerReady) routeAudio(next);
    void (async () => {
      try {
        await onChange?.(next);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    })();
  };

  // Chosen speakers that are not on the network right now stay listed, so they can be removed.
  const names = [...new Set([...(outputs ?? []), ...chosen])];
  return (
    <div className="space-y-2">
      {!isPlayerReady && (
        <p role="status" className="text-xs status-warning">
          This tablet&apos;s player isn&apos;t ready, so speakers can&apos;t be added yet.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs status-danger">
          {error}
        </p>
      )}
      {outputs && names.length === 0 && (
        <p className="text-xs leading-relaxed text-muted py-4">
          Looking for AirPlay speakers on this network. Sonos speakers show up once AirPlay is on in the Sonos app.
        </p>
      )}
      {names.map(name => {
        const isChosen = chosen.includes(name);
        let availability = 'Checking availability';
        if (error) availability = 'Availability unknown';
        else if (outputs) availability = outputs.includes(name) ? 'Available on this network' : 'Not on the network';
        return (
          <button
            type="button"
            key={name}
            aria-pressed={isChosen}
            disabled={!isPlayerReady && !isChosen}
            onClick={() => toggle(name)}
            className="modal-option w-full p-3 flex gap-3 items-center text-left rounded-xl border"
          >
            <Speaker size={20} className="shrink-0 text-accent" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm truncate">{name}</span>
              <span className="text-[11px] text-muted">{availability}</span>
            </span>
            {isChosen && (
              <span className="text-xs text-accent flex items-center gap-1">
                <Check size={14} /> Selected
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
