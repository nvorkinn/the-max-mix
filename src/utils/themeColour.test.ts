import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  basePalette,
  contrast,
  dynamicPalette,
  isOldDynamic,
  loadDynamicColour,
  loadThemeColour,
  saveDynamicColour,
  saveThemeColour,
  swatchOf,
  THEME_COLOURS,
  toThemeColour
} from './themeColour';

describe('theme colour setting', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('is forest by default', () => {
    expect(loadThemeColour()).toBe('forest');
  });

  it('remembers a choice and forgets the default', () => {
    saveThemeColour('plum');
    expect(loadThemeColour()).toBe('plum');
    saveThemeColour('forest');
    expect(localStorage.getItem('maxmix.themeColour')).toBeNull();
  });

  it('ignores a stored value that is not one of the choices', () => {
    localStorage.setItem('maxmix.themeColour', 'rainbow');
    expect(loadThemeColour()).toBe('forest');
  });

  it('tolerates unavailable storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadThemeColour()).toBe('forest');
    expect(() => saveThemeColour('navy')).not.toThrow();
  });

  it('reads the old Dynamic colour from the server as the default colour', () => {
    expect(toThemeColour('dynamic')).toBe('forest');
    expect(isOldDynamic('dynamic')).toBe(true);
    expect(toThemeColour('teal')).toBe('teal');
    expect(isOldDynamic('teal')).toBe(false);
  });
});

describe('Dynamic setting', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('is off by default', () => {
    expect(loadDynamicColour()).toBe(false);
  });

  it('remembers on and off', () => {
    saveDynamicColour(true);
    expect(loadDynamicColour()).toBe(true);
    saveDynamicColour(false);
    expect(loadDynamicColour()).toBe(false);
    expect(localStorage.getItem('maxmix.dynamicColour')).toBeNull();
  });

  it('turns on for someone who had picked the old Dynamic colour, over the default colour', () => {
    localStorage.setItem('maxmix.themeColour', 'dynamic');
    expect(loadDynamicColour()).toBe(true);
    expect(loadThemeColour()).toBe('forest');
    expect(localStorage.getItem('maxmix.themeColour')).toBeNull();
    expect(localStorage.getItem('maxmix.dynamicColour')).toBe('on');
  });

  it('tolerates unavailable storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadDynamicColour()).toBe(false);
    expect(() => saveDynamicColour(true)).not.toThrow();
  });

  it('keeps a colour picked alongside it', () => {
    saveThemeColour('navy');
    saveDynamicColour(true);
    expect(loadDynamicColour()).toBe(true);
    expect(loadThemeColour()).toBe('navy');
  });
});

describe('basePalette', () => {
  it("runs Violet's play button pink to violet", () => {
    expect(basePalette('violet')).toMatchObject({
      '--dynamic-accent': '#a95be8',
      '--dynamic-from': '#e94dae',
      '--dynamic-to': '#913fcb'
    });
  });

  it("is the chosen colour's own, its gradient on the play button and the logo, with its icon", () => {
    expect(basePalette('black')).toEqual({
      '--dynamic-accent': '#dfe3ee',
      '--dynamic-from': '#f0f2f7',
      '--dynamic-to': '#aab3c5',
      '--dynamic-accent-ink': '#111',
      '--dynamic-mark-from': '#f0f2f7',
      '--dynamic-mark-to': '#aab3c5',
      '--dynamic-mark-ink': '#111'
    });
    expect(basePalette('navy')).toMatchObject({ '--dynamic-mark-from': '#6fa8ff', '--dynamic-mark-ink': '#fff' });
  });

  it('gives every colour a gradient for its swatch', () => {
    for (const choice of THEME_COLOURS) expect(swatchOf(choice)).toMatch(/^linear-gradient\(135deg, #\w+, #\w+\)$/);
  });
});

describe('dynamicPalette', () => {
  const PAGE = [9, 14, 31] as const;
  /** The rgb() of an hsl() string, via the browser-free formula. */
  function rgbOf(colour: string): [number, number, number] {
    const [h, s, l] = (colour.match(/[\d.]+/g) ?? []).map(Number) as [number, number, number];
    const sat = s / 100;
    const light = l / 100;
    const chroma = (1 - Math.abs(2 * light - 1)) * sat;
    const part = (n: number) => {
      const k = (n + h / 30) % 12;
      return Math.round(255 * (light - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [part(0), part(8), part(4)];
  }

  it.each([
    ['a deep blue', [20, 30, 140]],
    ['a dark red', [90, 10, 10]],
    ['a near black', [12, 12, 14]],
    ['a pale yellow', [250, 240, 180]],
    ['a vivid green', [30, 220, 40]]
  ] as const)('lights %s just enough to read on the navy, without glaring', (_name, first) => {
    const palette = dynamicPalette([first, [120, 40, 160]]);
    const accent = rgbOf(palette['--dynamic-accent']);
    expect(contrast(accent, PAGE)).toBeGreaterThanOrEqual(4.5);
    expect(Number(palette['--dynamic-accent'].split(' ', 3)[2]?.replace('%)', ''))).toBeLessThanOrEqual(85);
  });

  it('softens a vivid colour and keeps the play button out of the glare', () => {
    const palette = dynamicPalette([
      [255, 0, 60],
      [255, 255, 255]
    ]);
    expect(palette['--dynamic-accent']).toBe('hsl(346 70% 60%)');
    expect(palette['--dynamic-from']).toBe('hsl(346 75% 50%)');
    expect(palette['--dynamic-to']).toBe('hsl(0 0% 60%)');
    expect(palette['--dynamic-mark-from']).toBe(palette['--dynamic-from']);
    expect(palette['--dynamic-accent-ink']).toBe('#fff');
  });

  it('lifts a near-black gradient end', () => {
    const palette = dynamicPalette([
      [20, 50, 30],
      [10, 10, 40]
    ]);
    expect(palette['--dynamic-to']).toBe('hsl(240 60% 45%)');
  });

  it('puts a dark icon on a light yellow and green gradient', () => {
    const palette = dynamicPalette([
      [240, 220, 60],
      [140, 220, 90]
    ]);
    expect(palette['--dynamic-accent-ink']).toBe('hsl(53 30% 12%)');
  });
});
