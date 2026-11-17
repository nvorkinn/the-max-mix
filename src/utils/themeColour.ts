// The colour of the track title, player controls and highlights, picked in the settings. Each choice is a
// `data-colour` value on .tablet-container that swaps the --ink and --accent variables (src/index.css). Storage can be
// unavailable: every access tolerates that.

import type { Rgb } from './colorExtractor';

const THEME_COLOUR_KEY = 'maxmix.themeColour';
/** Dynamic, on or off: the colours follow the album art while music plays. Off by default. */
const DYNAMIC_COLOUR_KEY = 'maxmix.dynamicColour';

/**
 * The choices the settings offer, with the swatch each one shows and the colours its `data-colour` rule in src/index.css
 * sets (Dynamic fades back to them when the music stops, see basePalette). The first is the default.
 */
export const THEME_COLOURS = [
  { id: 'forest', label: 'Forest', swatch: '#293a27', accent: '#293a27', ink: '#23291f', accentInk: '#fff' },
  { id: 'navy', label: 'Navy', swatch: '#1f3a5f', accent: '#1f3a5f', ink: '#1b2433', accentInk: '#fff' },
  { id: 'teal', label: 'Teal', swatch: '#155e63', accent: '#155e63', ink: '#17302f', accentInk: '#fff' },
  { id: 'plum', label: 'Plum', swatch: '#5b2a4e', accent: '#5b2a4e', ink: '#2e1f2b', accentInk: '#fff' },
  {
    id: 'terracotta',
    label: 'Terracotta',
    swatch: '#9a3f24',
    accent: '#9a3f24',
    ink: '#3a221a',
    accentInk: '#fff'
  },
  { id: 'pink', label: 'Pink', swatch: '#ff69b4', accent: '#ff69b4', ink: '#3b1a2a', accentInk: '#3b1a2a' },
  { id: 'yellow', label: 'Yellow', swatch: '#e0b020', accent: '#a67c00', ink: '#3a3010', accentInk: '#1f1a05' },
  { id: 'black', label: 'Black', swatch: '#111', accent: '#111', ink: '#111', accentInk: '#fff' }
] as const;
export type ThemeColour = (typeof THEME_COLOURS)[number]['id'];
const DEFAULT_THEME_COLOUR: ThemeColour = 'forest';
/**
 * Dynamic used to be one of the colours, and countdown-server's config can still say it. It now means Dynamic on over
 * the default colour.
 */
const OLD_DYNAMIC = 'dynamic';

function isChoice(value: string): value is ThemeColour {
  return THEME_COLOURS.some(colour => colour.id === value);
}

/** A colour from storage or countdown-server's config, as one of the choices: old Dynamic, or anything else unknown, is the default. */
export function toThemeColour(value: string | null | undefined): ThemeColour {
  return value != null && isChoice(value) ? value : DEFAULT_THEME_COLOUR;
}

/** Whether a colour from countdown-server's config is the old Dynamic choice, which turns Dynamic on. */
export function isOldDynamic(value: string | null | undefined): boolean {
  return value === OLD_DYNAMIC;
}

export function loadThemeColour(): ThemeColour {
  try {
    return toThemeColour(localStorage.getItem(THEME_COLOUR_KEY));
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

/** Whether Dynamic is on: stored as its own setting, or the old Dynamic colour choice, which this moves over. */
export function loadDynamicColour(): boolean {
  try {
    if (isOldDynamic(localStorage.getItem(THEME_COLOUR_KEY))) {
      localStorage.removeItem(THEME_COLOUR_KEY);
      localStorage.setItem(DYNAMIC_COLOUR_KEY, 'on');
      return true;
    }
    return localStorage.getItem(DYNAMIC_COLOUR_KEY) === 'on';
  } catch {
    return false;
  }
}

export function saveDynamicColour(on: boolean): void {
  try {
    if (on) localStorage.setItem(DYNAMIC_COLOUR_KEY, 'on');
    else localStorage.removeItem(DYNAMIC_COLOUR_KEY);
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

/** The colours Dynamic gives the page, as the CSS variables src/index.css reads under data-dynamic. */
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

/**
 * Dynamic's colours when nothing has played for a while: the chosen colour's own, so the page fades back to it, and the
 * play button's gradient runs from that colour to itself.
 */
export function basePalette(colour: ThemeColour): DynamicPalette {
  const choice = THEME_COLOURS.find(entry => entry.id === colour) ?? THEME_COLOURS[0];
  return {
    '--dynamic-accent': choice.accent,
    '--dynamic-ink': choice.ink,
    '--dynamic-from': choice.accent,
    '--dynamic-to': choice.accent,
    '--dynamic-accent-ink': choice.accentInk
  };
}
