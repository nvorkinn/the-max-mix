// The day's photo for a screen other than the Dashboard: the same one the Dashboard shows, from the same feed
// (live.ts). It follows only the feed's weather, which carries the photos, so a bus coming closer redraws nothing here.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { backdropOf } from './dashboardProps';
import { liveDashboard } from './live';
import type { LiveDashboard } from './live';

/** The latest of `value` that wasn't null: before the new day's first photo is due, yesterday's last one stays. */
export function useLastKnown(value: string | null | undefined): string | null {
  const lastRef = useRef<string | null>(null);
  if (value) lastRef.current = value;
  return value ?? lastRef.current;
}

/** The day's photo at `now`, or null while the server has given none (the caller shows the app's own). */
export function useDayPhoto(now: Date, source: LiveDashboard = liveDashboard()): string | null {
  useEffect(() => {
    source.start();
    return () => source.stop();
  }, [source]);
  const weather = useSyncExternalStore(source.subscribe, () => source.getSnapshot().weather);
  return useLastKnown(backdropOf(weather, now));
}
