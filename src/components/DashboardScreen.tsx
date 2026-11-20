import { useEffect, useState } from 'react';
import type { TabBarProps } from '../dashboard/props';
import { useDashboardProblem } from '../dashboard/useDashboardProblem';
import { useLiveDashboard } from '../dashboard/useLiveDashboard';
import Dashboard from './Dashboard';

/** How often the boards' clock moves on: often enough that a departure reaches "Due" on its minute. */
const TICK_MS = 1000;

/** The time now, moving on every TICK_MS while `running`, and at once when it starts running again. */
function useNow(running: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      setNow(new Date());
    };
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, TICK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [running]);
  return now;
}

/**
 * The Dashboard tab's content: countdown-server's live feed (useLiveDashboard), counted down on a clock of its own, so
 * its ticks redraw only the Dashboard. The Dashboard stays mounted behind the other tabs, so the feed stays open and
 * it shows the latest at once, but its clock only runs while it shows: hidden, it isn't redrawn every second. What is
 * wrong with its data goes under the tab bar's warning, hidden or not.
 */
export default function DashboardScreen({ tabBar }: Readonly<{ tabBar: TabBarProps }>) {
  const now = useNow(tabBar.active === 'dashboard');
  useDashboardProblem();
  return <Dashboard tabBar={tabBar} {...useLiveDashboard(now, tabBar.clockFormat)} />;
}
