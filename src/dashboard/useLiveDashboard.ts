// The redesigned Dashboard's live data for React: opens countdown-server's feed while mounted (live.ts) and gives the
// components' props as of `now` (dashboardProps.ts). The caller owns the clock, so the boards count down on the same
// tick as the tab bar's clock, and a test or the fixture's simulated clock can drive it.

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ClockFormat } from '../utils/clockFormat';
import { dashboardProps } from './dashboardProps';
import type { DashboardProps } from './dashboardProps';
import { liveDashboard } from './live';
import type { LiveDashboard } from './live';

/** @public Used by the redesigned Dashboard's components once they replace the current ones (step 2). */
export function useLiveDashboard(
  now: Date,
  clockFormat: ClockFormat,
  source: LiveDashboard = liveDashboard()
): DashboardProps {
  useEffect(() => {
    source.start();
    return () => source.stop();
  }, [source]);
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const time = now.getTime();
  return useMemo(() => dashboardProps(snapshot, new Date(time), clockFormat), [snapshot, time, clockFormat]);
}
