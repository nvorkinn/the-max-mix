import { useState, useEffect, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Check, Speaker, Volume2 } from 'lucide-react';
import {
  getChosenSpeakers,
  listAudioOutputs,
  routeAudio,
  setChosenSpeakers,
  setSpeakerVolume,
  watchAudioOutputs
} from '../audio/airplay';
import { errorMessage } from '../utils/errorMessage';

/** How long a volume set here wins over the Pi's answer, so a list read during the drag does not move the slider back. */
const HOLD_MS = 5000;

/**
 * The audio outputs Chromium sees (the Pi makes one for each AirPlay speaker it finds). Each tap adds or removes one,
 * requesting a route to the chosen speakers only when the player is ready. Saved choices can be removed before then.
 * Chromium cannot confirm playback on that route. While `active` is false (another speaker is playing) nothing counts as
 * chosen, and the next tap starts a new selection. Each chosen speaker on the network has its own volume slider.
 */
export default function AirPlaySpeakerList({
  isPlayerReady,
  notReadyMessage = "This tablet's player isn't ready, so speakers can't be added yet.",
  active = true,
  onChange
}: Readonly<{
  isPlayerReady: boolean;
  /** Said while speakers cannot be added yet. */
  notReadyMessage?: string;
  active?: boolean | undefined;
  /** Called with the speakers now chosen, after they were saved and (with a ready player) routed. */
  onChange?: ((speakers: string[]) => unknown) | undefined;
}>) {
  const [outputs, setOutputs] = useState<string[] | null>(null);
  const [chosen, setChosen] = useState(getChosenSpeakers);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  // When each speaker's volume was last set here.
  const volumeSetAtRef = useRef(new Map<string, number>());
  const [error, setError] = useState<string | null>(null);
  if (!active && chosen.length > 0) setChosen([]);

  const refresh = useCallback(async () => {
    try {
      const speakers = await listAudioOutputs();
      setOutputs(speakers.names);
      setVolumes(current => {
        const next = { ...speakers.volumes };
        for (const [name, time] of volumeSetAtRef.current) {
          const held = current[name];
          if (held !== undefined && Date.now() - time < HOLD_MS) next[name] = held;
        }
        return next;
      });
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

  const changeVolume = (name: string, volume: number) => {
    volumeSetAtRef.current.set(name, Date.now());
    setVolumes(current => ({ ...current, [name]: volume }));
    setSpeakerVolume(name, volume);
  };

  // Chosen speakers that are not on the network right now stay listed, so they can be removed.
  const names = [...new Set([...(outputs ?? []), ...chosen])];
  return (
    <div className="space-y-2">
      {!isPlayerReady && (
        <p role="status" className="text-xs status-warning">
          {notReadyMessage}
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
          Connected Bluetooth speakers are listed here too.
        </p>
      )}
      {names.map(name => {
        const isChosen = chosen.includes(name);
        let availability = 'Checking availability';
        if (error) availability = 'Availability unknown';
        else if (outputs) availability = outputs.includes(name) ? 'Available on this network' : 'Not on the network';
        const volume = isChosen && outputs?.includes(name) ? volumes[name] : undefined;
        return (
          <div key={name}>
            <button
              type="button"
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
            {volume !== undefined && (
              <label className="speaker-volume">
                <Volume2 size={16} aria-hidden="true" />
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={volume}
                  aria-label={`${name} volume`}
                  onChange={event => changeVolume(name, Number(event.target.value))}
                  className="range-control volume-range"
                  style={{ '--range-progress': `${volume}%` } as CSSProperties}
                />
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}
