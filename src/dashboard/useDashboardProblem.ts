// What is wrong with the Dashboard's departures, for the warning in the tab bar (problems.ts): the boards dim themselves
// when their data is old (dashboardProps.ts), and this says so in words, on every tab, with the same thresholds. Old
// weather only dims the hourly strip: it changes slowly, so it isn't worth a warning. The check runs on a clock of its
// own, as the Dashboard's clock stops while another tab shows.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useT } from '../i18n/translate';
import { useReportProblem } from '../problems/problems';
import { DEPARTURES_STALE_MS, STALE_AFTER_MS } from './dashboardProps';
import { liveDashboard } from './live';
import type { LiveDashboard, LiveSnapshot } from './live';

/** How often the check runs; the shortest threshold is 30 s, so a problem shows within a quarter of a minute of it. */
const CHECK_MS = 15_000;

export type DashboardTrouble = 'feed' | 'departures';

const olderThan = (time: string | undefined, ms: number, now: number) =>
  time !== undefined && now - Date.parse(time) > ms;

/** The worst thing wrong with `snapshot` at `now`: the feed down (so everything is old), or old departures. */
export function dashboardTrouble(snapshot: LiveSnapshot, now: number): DashboardTrouble | null {
  if (snapshot.downSince !== null && now - snapshot.downSince >= STALE_AFTER_MS) return 'feed';
  const oldDepartures = (snapshot.arrivals?.stops ?? []).some(
    stop => snapshot.heldStops.has(stop.id) || olderThan(stop.departures?.fetched_at, DEPARTURES_STALE_MS, now)
  );
  return oldDepartures ? 'departures' : null;
}

/** Reports what is wrong with the Dashboard's data while it lasts. */
export function useDashboardProblem(source: LiveDashboard = liveDashboard()): void {
  const t = useT();
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CHECK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const trouble = dashboardTrouble(snapshot, now);
  const titles: Record<DashboardTrouble, string> = {
    feed: t('problems.dashboard'),
    departures: t('problems.departures')
  };
  useReportProblem('dashboard', trouble && { title: titles[trouble] });
}
