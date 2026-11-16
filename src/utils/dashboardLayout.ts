// How the Dashboard tab is laid out, picked in Settings > Appearance: the four layouts of the London Dashboard mockup
// sheet. Kept on the kiosk for now: countdown-api's TouchscreenStyle has no field for it yet. Storage can be
// unavailable: every access tolerates that.

const DASHBOARD_LAYOUT_KEY = 'maxmix.dashboardLayout';

/** The choices the settings offer. The first is the default. */
export const DASHBOARD_LAYOUTS = [
  // A: the notice board down the left, the weather over a photo, the Tube and buses under it.
  { id: 'list', label: 'List' },
  // B: a big clock and the weather over the photo, the notices in a strip across it, the next Tube and buses under it.
  { id: 'banner', label: 'Banner' },
  // C: the notices as a timeline down the left, the next departures together, the weather in a strip under them.
  { id: 'timeline', label: 'Timeline' },
  // D: the weather and the notices as tiles across the top, the Tube, the buses and later today under them.
  { id: 'modular', label: 'Modular' }
] as const;
export type DashboardLayout = (typeof DASHBOARD_LAYOUTS)[number]['id'];
export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = 'list';

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
