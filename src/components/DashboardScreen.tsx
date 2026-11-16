import { useEffect, useState } from 'react';
import type { TabBarProps } from '../dashboard/props';
import { useLiveDashboard } from '../dashboard/useLiveDashboard';
import Dashboard from './Dashboard';

/** How often the boards' clock moves on: often enough that a departure reaches "Due" on its minute. */
const TICK_MS = 1000;

/** The time now, moving on every TICK_MS. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * The Dashboard tab's content: countdown-server's live feed (useLiveDashboard), counted down on a clock of its own, so
 * its ticks redraw only the Dashboard. The feed stays open while the tab shows.
 */
export default function DashboardScreen({ tabBar }: Readonly<{ tabBar: TabBarProps }>) {
  const now = useNow();
  return <Dashboard tabBar={tabBar} {...useLiveDashboard(now, tabBar.clockFormat)} />;
}
