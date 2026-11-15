import { useCallback, useEffect, useRef, useState } from 'react';
import type { TouchscreenConfig } from 'countdown-api';
import { loadDeviceConfig, saveConfigSection } from '../countdown/config';
import type { ConfigSection } from '../countdown/config';

/** How long a section waits after a change before it saves, so a run of quick taps sends only the last one. */
export const SAVE_DEBOUNCE_MS = 500;

/** How long the Saved tick, or the message for a change that didn't save, stays up. */
const SAVE_NOTE_MS = 2500;

/** Where the last save stands, for the Settings tab's Saved tick and its message when a change didn't save. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

export interface DeviceConfig {
  /**
   * The config as the kiosk shows it: the server's, with any change not yet saved already in it. Null until the kiosk
   * has one; the pairing value (pairing_code set) while no one owns the kiosk.
   */
  config: TouchscreenConfig | null;
  /** Whether changes go to the server: once someone owns the kiosk. Before that the kiosk's settings are its own. */
  owned: boolean;
  /** Changes one section at once and saves it a moment later; a failed save puts the section back as it was. */
  save: <K extends ConfigSection>(section: K, value: TouchscreenConfig[K]) => void;
  status: SaveStatus;
  /** Gets the config from the server again (the Settings tab does, each time it opens). */
  reload: () => void;
}

/**
 * The kiosk's config from countdown-server: loaded at start and whenever asked, and saved a section at a time from the
 * Settings tab. Each change shows at once and saves in the background; a failed save undoes it, and a save the server
 * calls out of date loads the latest config instead.
 */
export function useDeviceConfig(): DeviceConfig {
  const [config, setConfig] = useState<TouchscreenConfig | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  // The config as the server last gave it, which a failed save goes back to.
  const savedRef = useRef<TouchscreenConfig | null>(null);
  // The config as shown, changes and all, which the next change builds on.
  const shownRef = useRef<TouchscreenConfig | null>(null);
  const timersRef = useRef(new Map<ConfigSection, ReturnType<typeof setTimeout>>());
  const mountedRef = useRef(true);

  const show = useCallback((next: TouchscreenConfig | null) => {
    shownRef.current = next;
    setConfig(next);
  }, []);

  const reload = useCallback(() => {
    void loadDeviceConfig().then(loaded => {
      if (!loaded || !mountedRef.current) return;
      // A section still waiting to save keeps its change.
      savedRef.current = loaded;
      const shown = shownRef.current;
      let next = loaded;
      if (shown) for (const key of timersRef.current.keys()) next = { ...next, [key]: shown[key] };
      show(next);
    });
  }, [show]);

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    reload();
    return () => {
      mountedRef.current = false;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [reload]);

  useEffect(() => {
    if (status !== 'saved' && status !== 'failed') return;
    const timer = setTimeout(() => {
      setStatus('idle');
    }, SAVE_NOTE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [status]);

  const save = useCallback(
    <K extends ConfigSection>(section: K, value: TouchscreenConfig[K]) => {
      const shown = shownRef.current;
      if (shown?.pairing_code !== null) return;
      show({ ...shown, [section]: value });
      const timers = timersRef.current;
      clearTimeout(timers.get(section));
      timers.set(
        section,
        setTimeout(() => {
          timers.delete(section);
          const base = savedRef.current ?? shown;
          setStatus('saving');
          void saveConfigSection(base, section, value).then(result => {
            if (!mountedRef.current) return;
            if ('saved' in result) {
              savedRef.current = result.saved;
              const current = shownRef.current ?? result.saved;
              // Another section changed meanwhile keeps its change; this one takes the server's answer.
              show({ ...current, [section]: result.saved[section] });
              setStatus('saved');
              return;
            }
            setStatus('failed');
            if (result.error === 'conflict') {
              reload();
              return;
            }
            const before = savedRef.current;
            const current = shownRef.current;
            if (before && current) show({ ...current, [section]: before[section] });
          });
        }, SAVE_DEBOUNCE_MS)
      );
    },
    [reload, show]
  );

  return { config, owned: config?.pairing_code === null, save, status, reload };
}
