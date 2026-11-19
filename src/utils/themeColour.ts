// The colour of the track title, player controls and highlights, picked in the settings. Each choice is a
// `data-colour` value on .tablet-container that swaps the --ink and --accent variables (src/index.css). Storage can be
// unavailable: every access tolerates that.

import type { Rgb } from './colorExtractor';

const THEME_COLOUR_KEY = 'maxmix.themeColour';
/** Dynamic, on or off: the colours follow the album art while music plays. Off by default. */
const DYNAMIC_COLOUR_KEY = 'maxmix.dynamicColour';

/**
 * The choices the settings offer, with the swatch each one shows and the colours its `data-colour` rule in src/index.css
 * sets (Dynamic fades back to them when the music stops, see basePalette). `night` is the lighter shade Night shows
 * instead, with `nightAccentInk` on the play button where it differs from `accentInk`. The first is the default.
 */
export const THEME_COLOURS = [
  {
    id: 'forest',
    label: 'Forest',
    swatch: '#293a27',
    accent: '#293a27',
    ink: '#23291f',
    accentInk: '#fff',
    night: '#4a9d5e'
  },
  {
    id: 'navy',
    label: 'Navy',
    swatch: '#1f3a5f',
    accent: '#1f3a5f',
    ink: '#1b2433',
    accentInk: '#fff',
    night: '#5b8def'
  },
  {
    id: 'teal',
    label: 'Teal',
    swatch: '#155e63',
    accent: '#155e63',
    ink: '#17302f',
    accentInk: '#fff',
    night: '#2a9d9d'
  },
  {
    id: 'plum',
    label: 'Plum',
    swatch: '#5b2a4e',
    accent: '#5b2a4e',
    ink: '#2e1f2b',
    accentInk: '#fff',
    night: '#c25ea8'
  },
  {
    id: 'terracotta',
    label: 'Terracotta',
    swatch: '#9a3f24',
    accent: '#9a3f24',
    ink: '#3a221a',
    accentInk: '#fff',
    night: '#dd6b3d'
  },
  {
    id: 'pink',
    label: 'Pink',
    swatch: '#ff69b4',
    accent: '#ff69b4',
    ink: '#3b1a2a',
    accentInk: '#3b1a2a',
    night: '#ff69b4'
  },
  {
    id: 'yellow',
    label: 'Yellow',
    swatch: '#e0b020',
    accent: '#a67c00',
    ink: '#3a3010',
    accentInk: '#1f1a05',
    night: '#e0b020'
  },
  {
    id: 'black',
    label: 'Black',
    swatch: '#111',
    accent: '#111',
    ink: '#111',
    accentInk: '#fff',
    night: '#dfe3ee',
    nightAccentInk: '#111'
  },
  // Night's look as a colour of its own: violet, with the play button running pink to violet.
  {
    id: 'violet',
    label: 'Violet',
    swatch: 'linear-gradient(135deg, #e94dae, #913fcb)',
    accent: '#913fcb',
    ink: '#2a1838',
    accentInk: '#fff',
    night: '#a95be8',
    gradient: ['#e94dae', '#913fcb'],
    // The selected outline, as a gradient can't be one.
    ring: '#913fcb'
  }
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
  /** The Max Mix logo's tile: the play button's gradient while music plays, else the chosen colour. */
  '--dynamic-mark-from': string;
  '--dynamic-mark-to': string;
  '--dynamic-mark-ink': string;
}

/**
 * What Dynamic's colours sit on: the paper of Day, or the dark: the navy of Night, and the darkened photo of the Spotify
 * and Settings tabs, whatever the skin.
 */
export type DynamicSurface = 'day' | 'night';

/** Night's text, which Dynamic leaves as it is on the dark. */
const NIGHT_INK = '#f5f6ff';
/** Night's page: the darkest the highlights have to read on. The Spotify tab's glass is about as dark. */
const NIGHT_PAGE: Rgb = [9, 14, 31];

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

/** One end of the play button's gradient: the colour at a middle lightness, neither washed out nor near black. */
function gradientEnd(colour: Rgb, dark: boolean): { h: number; s: number; l: number } {
  const [h, s, l] = toHsl(colour);
  // On the dark the button is kept a little dimmer and less saturated, near Night's own pink to violet, so it doesn't glare.
  return dark ? { h, s: Math.min(s, 0.75), l: clamp(l, 0.45, 0.6) } : { h, s, l: clamp(l, 0.35, 0.6) };
}

/**
 * The title and highlights on the dark: the cover's colour, softened, and only as light as it takes to read on the
 * navy (4.5:1), so it stays dim at night rather than glowing. Grey covers give a silver, as Black does at night.
 */
function nightAccent(hue: number, saturation: number, lightness: number): string {
  const s = Math.min(saturation, 0.7);
  let l = clamp(lightness, 0.6, 0.72);
  while (l < 0.85 && contrast(hslToRgb(hue, s, l), NIGHT_PAGE) < 4.5) l += 0.01;
  return hsl(hue, s, l);
}

/**
 * Turns the cover's two dominant colours into Dynamic's colours. The title and highlights take the first colour: by
 * day darkened where needed so it reads on the paper, with a near-black text ink of the same hue; on the dark (Night,
 * and the photo tabs) a lighter, softened shade, and the text stays the dark's own. The play button runs a
 * gradient between the two colours, like Night's, kept in a middle lightness so it stands out, with a white or dark icon
 * on it, whichever reads better.
 */
export function dynamicPalette([first, second]: readonly [Rgb, Rgb], surface: DynamicSurface = 'day'): DynamicPalette {
  const dark = surface === 'night';
  const [hue, saturation, lightness] = toHsl(first);
  const from = gradientEnd(first, dark);
  const to = gradientEnd(second, dark);
  // A light gradient of yellows and greens gets a dark icon, as Pink and Yellow do.
  const light = [from, to].every(end => end.l >= 0.5 && end.h >= 40 && end.h <= 190 && end.s > 0.3);
  const fromColour = hsl(from.h, from.s, from.l);
  const toColour = hsl(to.h, to.s, to.l);
  const icon = light ? hsl(hue, Math.min(saturation, 0.3), 0.12) : '#fff';
  return {
    '--dynamic-accent': dark
      ? nightAccent(hue, saturation, lightness)
      : hsl(hue, saturation, Math.min(lightness, 0.36)),
    '--dynamic-ink': dark ? NIGHT_INK : hsl(hue, Math.min(saturation, 0.3), 0.15),
    '--dynamic-from': fromColour,
    '--dynamic-to': toColour,
    '--dynamic-accent-ink': icon,
    '--dynamic-mark-from': fromColour,
    '--dynamic-mark-to': toColour,
    '--dynamic-mark-ink': icon
  };
}

/** The chosen colour as its play button shows it: by day, or its night shade, flat or with Violet's gradient. */
function chosen(colour: ThemeColour, night: boolean) {
  const choice: (typeof THEME_COLOURS)[number] = THEME_COLOURS.find(entry => entry.id === colour) ?? THEME_COLOURS[0];
  const accent = night ? choice.night : choice.accent;
  const [from, to] = 'gradient' in choice ? choice.gradient : [accent, accent];
  return {
    accent,
    ink: night ? NIGHT_INK : choice.ink,
    from,
    to,
    accentInk: night && 'nightAccentInk' in choice ? choice.nightAccentInk : choice.accentInk
  };
}

/**
 * Dynamic's colours when nothing has played for a while, so the page fades back to what it shows with Dynamic off: by
 * day the chosen colour, with that colour's own gradient (Violet's) or flat; on the dark the colour's night shade. The
 * logo's tile goes back to the chosen colour as the skin shows it (`nightSkin`), which on a photo tab by day is the
 * colour itself.
 */
export function basePalette(
  colour: ThemeColour,
  surface: DynamicSurface = 'day',
  nightSkin: boolean = surface === 'night'
): DynamicPalette {
  const logo = chosen(colour, nightSkin);
  const mark = { '--dynamic-mark-from': logo.from, '--dynamic-mark-to': logo.to, '--dynamic-mark-ink': logo.accentInk };
  const page = chosen(colour, surface === 'night');
  return {
    '--dynamic-accent': page.accent,
    '--dynamic-ink': page.ink,
    '--dynamic-from': page.from,
    '--dynamic-to': page.to,
    '--dynamic-accent-ink': page.accentInk,
    ...mark
  };
}
