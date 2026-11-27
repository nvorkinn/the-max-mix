// The colour of the track title, player controls and highlights, picked in the settings. Each choice is a
// `data-colour` value on .tablet-container that swaps the --ink and --accent variables (web/src/index.css). Storage can be
// unavailable: every access tolerates that.

import type { Rgb } from './colorExtractor';

const THEME_COLOUR_KEY = 'maxmix.themeColour';
/** Dynamic, on or off: the colours follow the album art while music plays. Off by default. */
const DYNAMIC_COLOUR_KEY = 'maxmix.dynamicColour';

/**
 * The choices the settings offer, with the colour its `data-colour` rule in web/src/index.css sets for words and thin lines,
 * the gradient it fills the play button, the logo's tile and selections with (Dynamic fades back to them when the music
 * stops, see basePalette), and the icon on the play button where it is not white. Each is bright enough to read on the
 * navy. The first is the default.
 */
export const THEME_COLOURS = [
  { id: 'forest', accent: '#4a9d5e', gradient: ['#6cc070', '#2e8b6e'] },
  { id: 'navy', accent: '#5b8def', gradient: ['#6fa8ff', '#4a5fd9'] },
  { id: 'teal', accent: '#2a9d9d', gradient: ['#3cc0b0', '#1f7fa0'] },
  { id: 'plum', accent: '#c25ea8', gradient: ['#e070b8', '#9a4a9e'] },
  { id: 'terracotta', accent: '#dd6b3d', gradient: ['#f0894a', '#c9483a'] },
  { id: 'pink', accent: '#ff69b4', gradient: ['#ff8cc6', '#ff4f9a'], accentInk: '#3b1a2a' },
  { id: 'yellow', accent: '#e0b020', gradient: ['#f5c842', '#e09a1a'], accentInk: '#1f1a05' },
  // Black would vanish on the navy, so it is a silver.
  { id: 'black', accent: '#dfe3ee', gradient: ['#f0f2f7', '#aab3c5'], accentInk: '#111' },
  { id: 'violet', accent: '#a95be8', gradient: ['#e94dae', '#913fcb'] }
] as const;

/** What a colour's swatch in the settings shows: its gradient. */
export function swatchOf(choice: (typeof THEME_COLOURS)[number]): string {
  return `linear-gradient(135deg, ${choice.gradient[0]}, ${choice.gradient[1]})`;
}
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

/** The colours Dynamic gives the page, as the CSS variables web/src/index.css reads under data-dynamic. */
export interface DynamicPalette {
  '--dynamic-accent': string;
  '--dynamic-from': string;
  '--dynamic-to': string;
  '--dynamic-accent-ink': string;
  /** The Max Mix logo's tile: the play button's gradient while music plays, else the chosen colour. */
  '--dynamic-mark-from': string;
  '--dynamic-mark-to': string;
  '--dynamic-mark-ink': string;
}

/** The page: the darkest the highlights have to read on. The Spotify tab's glass is about as dark. */
const PAGE: Rgb = [9, 14, 31];

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const part = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (lightness - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [part(0), part(8), part(4)];
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(value => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, from 1 to 21. */
export function contrast(first: Rgb, second: Rgb): number {
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
}

/**
 * One end of the play button's gradient: the colour at a middle lightness, a little dimmer and less saturated so it
 * doesn't glare on the dark, near Violet's pink to violet.
 */
function gradientEnd(colour: Rgb): { h: number; s: number; l: number } {
  const [h, s, l] = toHsl(colour);
  return { h, s: Math.min(s, 0.75), l: clamp(l, 0.45, 0.6) };
}

/**
 * The title and highlights: the cover's colour, softened, and only as light as it takes to read on the navy (4.5:1),
 * so it stays dim rather than glowing. Grey covers give a silver, as Black does.
 */
function readableAccent(hue: number, saturation: number, lightness: number): string {
  const s = Math.min(saturation, 0.7);
  let l = clamp(lightness, 0.6, 0.72);
  while (l < 0.85 && contrast(hslToRgb(hue, s, l), PAGE) < 4.5) l += 0.01;
  return hsl(hue, s, l);
}

/**
 * Turns the cover's two dominant colours into Dynamic's colours. The title and highlights take a lighter, softened
 * shade of the first colour; the text stays the app's own. The play button runs a gradient between the two colours,
 * like Violet's, kept in a middle lightness so it stands out, with a white or dark icon on it, whichever reads better.
 */
export function dynamicPalette([first, second]: readonly [Rgb, Rgb]): DynamicPalette {
  const [hue, saturation, lightness] = toHsl(first);
  const from = gradientEnd(first);
  const to = gradientEnd(second);
  // A light gradient of yellows and greens gets a dark icon, as Pink and Yellow do.
  const light = [from, to].every(end => end.l >= 0.5 && end.h >= 40 && end.h <= 190 && end.s > 0.3);
  const fromColour = hsl(from.h, from.s, from.l);
  const toColour = hsl(to.h, to.s, to.l);
  const icon = light ? hsl(hue, Math.min(saturation, 0.3), 0.12) : '#fff';
  return {
    '--dynamic-accent': readableAccent(hue, saturation, lightness),
    '--dynamic-from': fromColour,
    '--dynamic-to': toColour,
    '--dynamic-accent-ink': icon,
    '--dynamic-mark-from': fromColour,
    '--dynamic-mark-to': toColour,
    '--dynamic-mark-ink': icon
  };
}

/**
 * Dynamic's colours when nothing has played for a while, so the page fades back to what it shows with Dynamic off: the
 * chosen colour, with its own gradient on the play button and the logo's tile.
 */
export function basePalette(colour: ThemeColour): DynamicPalette {
  const choice: (typeof THEME_COLOURS)[number] = THEME_COLOURS.find(entry => entry.id === colour) ?? THEME_COLOURS[0];
  const [from, to] = choice.gradient;
  const ink = 'accentInk' in choice ? choice.accentInk : '#fff';
  return {
    '--dynamic-accent': choice.accent,
    '--dynamic-from': from,
    '--dynamic-to': to,
    '--dynamic-accent-ink': ink,
    '--dynamic-mark-from': from,
    '--dynamic-mark-to': to,
    '--dynamic-mark-ink': ink
  };
}
