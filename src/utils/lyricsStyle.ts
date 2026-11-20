// How the synced lyrics look: their type size and which way the lines line up. Kept on this tablet only. Storage can be
// unavailable: every access tolerates that, and the setting then lasts until the page reloads.

const LYRICS_STYLE_KEY = 'maxmix.lyricsStyle';

/** Type sizes the settings offer, each a multiple of the size the panel works out for itself. */
export const LYRICS_SIZES = [
  { id: 'small', scale: 0.6 },
  { id: 'medium', scale: 0.7 },
  { id: 'large', scale: 0.85 },
  { id: 'x-large', scale: 1 }
] as const;
export type LyricsSize = (typeof LYRICS_SIZES)[number]['id'];

export const LYRICS_ALIGNS = [{ id: 'left' }, { id: 'center' }, { id: 'right' }] as const;
export type LyricsAlign = (typeof LYRICS_ALIGNS)[number]['id'];

export interface LyricsStyle {
  size: LyricsSize;
  align: LyricsAlign;
}

export const DEFAULT_LYRICS_STYLE: LyricsStyle = { size: 'medium', align: 'left' };

const isSize = (value: unknown): value is LyricsSize => LYRICS_SIZES.some(size => size.id === value);
const isAlign = (value: unknown): value is LyricsAlign => LYRICS_ALIGNS.some(align => align.id === value);

function load(): LyricsStyle {
  try {
    const stored = localStorage.getItem(LYRICS_STYLE_KEY);
    if (stored === null) return DEFAULT_LYRICS_STYLE;
    const parsed = JSON.parse(stored) as Partial<LyricsStyle> | null;
    return {
      size: isSize(parsed?.size) ? parsed.size : DEFAULT_LYRICS_STYLE.size,
      align: isAlign(parsed?.align) ? parsed.align : DEFAULT_LYRICS_STYLE.align
    };
  } catch {
    return DEFAULT_LYRICS_STYLE;
  }
}

let current: LyricsStyle | undefined;
const listeners = new Set<() => void>();

/** The lyrics' look, the same object until it changes (for useSyncExternalStore). */
export function getLyricsStyle(): LyricsStyle {
  current ??= load();
  return current;
}

/** Changes the lyrics' look, keeps it, and tells the lyrics on screen. */
export function setLyricsStyle(change: Partial<LyricsStyle>): void {
  current = { ...getLyricsStyle(), ...change };
  try {
    if (current.size === DEFAULT_LYRICS_STYLE.size && current.align === DEFAULT_LYRICS_STYLE.align) {
      localStorage.removeItem(LYRICS_STYLE_KEY);
    } else {
      localStorage.setItem(LYRICS_STYLE_KEY, JSON.stringify(current));
    }
  } catch {
    // Storage is unavailable; the setting then lasts only until the page reloads.
  }
  for (const listener of listeners) listener();
}

export function subscribeLyricsStyle(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The multiple of the panel's own type size that `size` stands for. */
export function lyricsScale(size: LyricsSize): number {
  return LYRICS_SIZES.find(choice => choice.id === size)?.scale ?? 0.7;
}
