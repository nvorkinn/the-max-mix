import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadThemeColour, saveThemeColour } from './themeColour';

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
});
