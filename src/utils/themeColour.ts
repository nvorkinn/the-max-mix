// The colour of the track title, player controls and highlights, picked in the settings. Each choice is a
// `data-colour` value on .tablet-container that swaps the --ink and --accent variables (src/index.css). Storage can be
// unavailable: every access tolerates that.

const THEME_COLOUR_KEY = 'maxmix.themeColour';

/** The choices the settings offer, with the swatch each one shows. The first is the default. */
export const THEME_COLOURS = [
  { id: 'forest', label: 'Forest', swatch: '#293a27' },
  { id: 'navy', label: 'Navy', swatch: '#1f3a5f' },
  { id: 'teal', label: 'Teal', swatch: '#155e63' },
  { id: 'plum', label: 'Plum', swatch: '#5b2a4e' },
  { id: 'terracotta', label: 'Terracotta', swatch: '#9a3f24' },
  { id: 'pink', label: 'Pink', swatch: '#ff69b4' },
  { id: 'yellow', label: 'Yellow', swatch: '#e0b020' },
  { id: 'black', label: 'Black', swatch: '#111' }
] as const;
export type ThemeColour = (typeof THEME_COLOURS)[number]['id'];
const DEFAULT_THEME_COLOUR: ThemeColour = 'forest';

function isChoice(value: string): value is ThemeColour {
  return THEME_COLOURS.some(colour => colour.id === value);
}

export function loadThemeColour(): ThemeColour {
  try {
    const stored = localStorage.getItem(THEME_COLOUR_KEY);
    return stored !== null && isChoice(stored) ? stored : DEFAULT_THEME_COLOUR;
  } catch {
    return DEFAULT_THEME_COLOUR;
  }
}

export function saveThemeColour(colour: ThemeColour): void {
  try {
    if (colour === DEFAULT_THEME_COLOUR) localStorage.removeItem(THEME_COLOUR_KEY);
    else localStorage.setItem(THEME_COLOUR_KEY, colour);
  } catch {
    // Storage is unavailable; the setting then lasts only until the page reloads.
  }
}
