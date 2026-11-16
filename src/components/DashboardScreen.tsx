import { sampleDashboard, useSimulatedNow } from '../dashboard/sample';
import type { TabBarProps } from '../dashboard/props';
import Dashboard from './Dashboard';

/**
 * The Dashboard tab's content. Until the live feed is plugged in it shows the sample data, with a simulated clock that
 * counts its departures down; its own component so the clock's ticks redraw only the Dashboard.
 */
export default function DashboardScreen({ tabBar }: Readonly<{ tabBar: TabBarProps }>) {
  const now = useSimulatedNow();
  return <Dashboard tabBar={tabBar} {...sampleDashboard(now, tabBar.clockFormat)} />;
}
