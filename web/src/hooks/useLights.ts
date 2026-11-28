import { useCallback, useEffect, useRef, useState } from 'react';
import { configureLights, setLight, watchLights } from '../lights/kiosk';
import type { Light, LightsStatus } from '../lights/kiosk';

/** A dragged brightness is sent this long after the finger last moved, so a drag is a few requests and not hundreds. */
const SEND_AFTER_MS = 150;
/**
 * What was asked for is shown this long, whatever the service reports meanwhile: a light takes a moment to change, and
 * its old state must not flash back.
 */
const ASKED_SHOWN_MS = 2500;

/** What a person asked a light to be. */
interface Asked {
  on: boolean;
  brightness: number | null;
}

export interface Lights {
  /** Where the lights stand, with what was just asked for already shown; null when the kiosk has no lights. */
  status: LightsStatus | null;
  /** Turns a light on or off, or on at a brightness in percent (0 turns it off). */
  change: (light: Light, change: { on: boolean } | { brightness: number }) => void;
}

/**
 * The kiosk's lights, while `enabled` (on the kiosk): the service is told where the config is, again whenever
 * `config` changes (the owner may have changed the lights), and followed while the config has lights.
 */
export function useLights(enabled: boolean, config: unknown): Lights {
  const [status, setStatus] = useState<LightsStatus | null>(null);
  const [asked, setAsked] = useState<Record<string, Asked>>({});
  const timersRef = useRef(
    new Map<string, { send?: ReturnType<typeof setTimeout>; show?: ReturnType<typeof setTimeout> }>()
  );

  useEffect(() => {
    if (!enabled) return;
    let isCurrent = true;
    let stop: (() => void) | undefined;
    void configureLights().then(first => {
      if (!isCurrent) return;
      setStatus(first);
      if (first && first.state !== 'off') stop = watchLights(setStatus);
    });
    return () => {
      isCurrent = false;
      stop?.();
    };
  }, [enabled, config]);

  useEffect(() => {
    const held = timersRef.current;
    return () => {
      for (const { send, show } of held.values()) {
        clearTimeout(send);
        clearTimeout(show);
      }
    };
  }, []);

  const change = useCallback<Lights['change']>((light, wanted) => {
    const next: Asked =
      'on' in wanted
        ? { on: wanted.on, brightness: wanted.on ? light.brightness : null }
        : { on: wanted.brightness > 0, brightness: wanted.brightness > 0 ? wanted.brightness : null };
    setAsked(current => ({ ...current, [light.id]: next }));
    const held = timersRef.current.get(light.id) ?? {};
    timersRef.current.set(light.id, held);
    clearTimeout(held.send);
    clearTimeout(held.show);
    const send = () => {
      setLight(light.id, next.on, 'brightness' in wanted && next.brightness !== null ? next.brightness : undefined);
    };
    // A tap is sent at once; a drag once it rests.
    if ('on' in wanted) send();
    else held.send = setTimeout(send, SEND_AFTER_MS);
    held.show = setTimeout(() => {
      setAsked(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== light.id)));
    }, ASKED_SHOWN_MS);
  }, []);

  const shown = status && {
    ...status,
    lights: status.lights.map(light => ({ ...light, ...asked[light.id] }))
  };
  return { status: enabled ? shown : null, change };
}
