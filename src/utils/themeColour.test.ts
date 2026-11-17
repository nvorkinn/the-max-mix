import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  basePalette,
  dynamicPalette,
  isOldDynamic,
  loadDynamicColour,
  loadThemeColour,
  saveDynamicColour,
  saveThemeColour,
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
    expect(basePalette('violet')).toMatchObject({ '--dynamic-from': '#e94dae', '--dynamic-to': '#913fcb' });
  });

  it("is the chosen colour's own, with a flat play button", () => {
    expect(basePalette('yellow')).toEqual({
      '--dynamic-accent': '#a67c00',
      '--dynamic-ink': '#3a3010',
      '--dynamic-from': '#a67c00',
      '--dynamic-to': '#a67c00',
      '--dynamic-accent-ink': '#1f1a05'
    });
  });
});

describe('dynamicPalette', () => {
  it('darkens a light first colour for text and keeps both colours for the gradient', () => {
    expect(
      dynamicPalette([
        [240, 120, 120],
        [60, 60, 200]
      ])
    ).toEqual({
      '--dynamic-accent': 'hsl(0 80% 36%)',
      '--dynamic-ink': 'hsl(0 30% 15%)',
      '--dynamic-from': 'hsl(0 80% 60%)',
      '--dynamic-to': 'hsl(240 56% 51%)',
      '--dynamic-accent-ink': '#fff'
    });
  });

  it('keeps a dark first colour as it is and lifts a near-black gradient end', () => {
    const palette = dynamicPalette([
      [20, 50, 30],
      [10, 10, 40]
    ]);
    expect(palette['--dynamic-accent']).toBe('hsl(140 43% 14%)');
    expect(palette['--dynamic-to']).toBe('hsl(240 60% 35%)');
  });

  it('puts a dark icon on a light yellow and green gradient', () => {
    const palette = dynamicPalette([
      [240, 220, 60],
      [140, 220, 90]
    ]);
    expect(palette['--dynamic-accent-ink']).toBe('hsl(53 30% 12%)');
  });
});
