// The colour of the track title, player controls and highlights, picked in the settings. Each choice is a
// `data-colour` value on .tablet-container that swaps the --ink and --accent variables (src/index.css). Storage can be
// unavailable: every access tolerates that.

import type { Rgb } from './colorExtractor';

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
  { id: 'black', label: 'Black', swatch: '#111' },
  // Follows the album art of the song playing (dynamicPalette below); without art it looks like Forest.
  {
    id: 'dynamic',
    label: 'Dynamic',
    swatch: 'conic-gradient(#e94dae, #f0b64c, #57d3b4, #3b82c4, #913fcb, #e94dae)',
    ring: '#913fcb'
  }
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

/** Hue in degrees, saturation and lightness from 0 to 1. */
function toHsl([red, green, blue]: Rgb): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return [(hue * 60 + 360) % 360, saturation, lightness];
}

function hsl(hue: number, saturation: number, lightness: number): string {
  return `hsl(${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%)`;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The colours Dynamic gives the page, as the CSS variables src/index.css reads under data-colour='dynamic'. */
export interface DynamicPalette {
  '--dynamic-accent': string;
  '--dynamic-ink': string;
  '--dynamic-from': string;
  '--dynamic-to': string;
  '--dynamic-accent-ink': string;
}

/** One end of the play button's gradient: the colour at a middle lightness, neither washed out nor near black. */
function gradientEnd(colour: Rgb): { h: number; s: number; l: number } {
  const [h, s, l] = toHsl(colour);
  return { h, s, l: clamp(l, 0.35, 0.6) };
}

/**
 * Turns the cover's two dominant colours into Dynamic's colours. The title and highlights take the first colour,
 * darkened where needed so it reads on the paper; the text ink is a near-black of the same hue. The play button runs a
 * gradient between the two colours, like Night's, kept in a middle lightness so it stands out, with a white or dark icon
 * on it, whichever reads better.
 */
export function dynamicPalette([first, second]: readonly [Rgb, Rgb]): DynamicPalette {
  const [hue, saturation, lightness] = toHsl(first);
  const from = gradientEnd(first);
  const to = gradientEnd(second);
  // A light gradient of yellows and greens gets a dark icon, as Pink and Yellow do.
  const light = [from, to].every(end => end.l >= 0.5 && end.h >= 40 && end.h <= 190 && end.s > 0.3);
  return {
    '--dynamic-accent': hsl(hue, saturation, Math.min(lightness, 0.36)),
    '--dynamic-ink': hsl(hue, Math.min(saturation, 0.3), 0.15),
    '--dynamic-from': hsl(from.h, from.s, from.l),
    '--dynamic-to': hsl(to.h, to.s, to.l),
    '--dynamic-accent-ink': light ? hsl(hue, Math.min(saturation, 0.3), 0.12) : '#fff'
  };
}
