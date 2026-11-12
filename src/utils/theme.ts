// The app's skin, picked in the settings: Day is the paper look with the colour choice, Night a fixed dark navy one.
// The skin is a `data-theme` value on .tablet-container that redefines the colour tokens (src/index.css), so no
// component branches on it. Storage can be unavailable: every access tolerates that.

const THEME_KEY = 'maxmix.theme';

/** The choices the settings offer. The first is the default. */
export const THEMES = [
  { id: 'day', label: 'Day' },
  { id: 'night', label: 'Night' }
] as const;
export type Theme = (typeof THEMES)[number]['id'];
const DEFAULT_THEME: Theme = 'day';

function isTheme(value: string): value is Theme {
  return THEMES.some(theme => theme.id === value);
}

export function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored !== null && isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme: Theme): void {
  try {
    if (theme === DEFAULT_THEME) localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage is unavailable; the setting then lasts only until the page reloads.
  }
}
