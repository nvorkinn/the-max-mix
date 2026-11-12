import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadTheme, saveTheme } from './theme';

describe('theme setting', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('is day by default', () => {
    expect(loadTheme()).toBe('day');
  });

  it('remembers night and forgets the default', () => {
    saveTheme('night');
    expect(loadTheme()).toBe('night');
    saveTheme('day');
    expect(localStorage.getItem('maxmix.theme')).toBeNull();
  });

  it('ignores a stored value that is not one of the choices', () => {
    localStorage.setItem('maxmix.theme', 'dusk');
    expect(loadTheme()).toBe('day');
  });

  it('tolerates unavailable storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadTheme()).toBe('day');
    expect(() => saveTheme('night')).not.toThrow();
  });
});
