// How the Dashboard tab is laid out, picked in Settings > Appearance. Kept on the kiosk for now: countdown-api's
// TouchscreenStyle has no field for it yet. Storage can be unavailable: every access tolerates that.

const DASHBOARD_LAYOUT_KEY = 'maxmix.dashboardLayout';

/** The choices the settings offer. The first is the default. */
export const DASHBOARD_LAYOUTS = [
  // The notices down a column on the left, the weather and the departures beside them.
  { id: 'column', label: 'Side' },
  // The weather and the departures across the full width, the notices in a row under them.
  { id: 'strip', label: 'Bottom' },
  // A big clock and the weather in a band across the top, the notices along its foot, the departures under it.
  { id: 'clock', label: 'Clock' }
] as const;
export type DashboardLayout = (typeof DASHBOARD_LAYOUTS)[number]['id'];
const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = 'column';

function isChoice(value: string): value is DashboardLayout {
  return DASHBOARD_LAYOUTS.some(layout => layout.id === value);
}

export function loadDashboardLayout(): DashboardLayout {
  try {
    const stored = localStorage.getItem(DASHBOARD_LAYOUT_KEY);
    return stored !== null && isChoice(stored) ? stored : DEFAULT_DASHBOARD_LAYOUT;
  } catch {
    return DEFAULT_DASHBOARD_LAYOUT;
  }
}

export function saveDashboardLayout(layout: DashboardLayout): void {
  try {
    if (layout === DEFAULT_DASHBOARD_LAYOUT) localStorage.removeItem(DASHBOARD_LAYOUT_KEY);
    else localStorage.setItem(DASHBOARD_LAYOUT_KEY, layout);
  } catch {
    // Storage is unavailable; the choice then lasts only until the page reloads.
  }
}
