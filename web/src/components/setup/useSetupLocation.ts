import { useEffect, useState } from 'react';
import { keepSetupLocation, keptSetupLocation, locateKiosk } from '../../countdown/location';
import type { SetupLocation } from '../../countdown/location';
import { nearbyStops } from '../../countdown/search';
import type { NearbyStop } from '../../countdown/search';

/** How long the hook waits before its one second try, when the first found nothing. */
export const LOCATE_RETRY_MS = 5000;

/** What the hook found: undefined while it is still looking, null when it found nothing. */
export type SetupLocationAnswer = SetupLocation<NearbyStop> | null | undefined;

/**
 * Finds where the kiosk is in the background while `isRunning` (once it is registered and online), so the Location
 * chapter has its postcodes ready by the time the owner is done on their phone: the Wi-Fi networks the Pi sees, which
 * the server places and gives the postcodes nearest, then the stops nearest that position. The answer is kept for an
 * hour, as signing in reloads the page; one kept is used again, not scanned for. One more try when the first finds
 * nothing, then null: the chapter then has no suggestions. Stops that couldn't be had are null, for the chapter to ask
 * for again.
 */
export function useSetupLocation(isRunning: boolean): SetupLocationAnswer {
  const [kept] = useState(() => keptSetupLocation<NearbyStop>());
  const [found, setFound] = useState<SetupLocationAnswer>(kept ?? undefined);
  const isFound = found !== undefined;
  useEffect(() => {
    if (!isRunning || isFound) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Read through a call, so each step sees whether it has been stopped while it waited.
    const gone = () => controller.signal.aborted;
    const attempt = async (triesLeft: number): Promise<void> => {
      const location = await locateKiosk(controller.signal);
      if (gone()) return;
      if (!location) {
        if (triesLeft > 0) timer = setTimeout(() => void attempt(triesLeft - 1), LOCATE_RETRY_MS);
        else setFound(null);
        return;
      }
      const stops = await nearbyStops(location, controller.signal).catch(() => null);
      if (gone()) return;
      const answer = { location, stops };
      keepSetupLocation(answer);
      setFound(answer);
    };
    void attempt(1);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [isRunning, isFound]);
  return found;
}
