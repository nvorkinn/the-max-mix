import { afterEach, expect, it, vi } from 'vitest';
import { reloadSettings } from './settings';

afterEach(() => vi.unstubAllGlobals());

it('removes a forced demo query while preserving kiosk parameters and the fragment', () => {
  const assign = vi.fn();
  vi.stubGlobal('location', { href: 'https://example.invalid/?demo=true&kiosk=1#player', assign });
  reloadSettings();
  expect(assign).toHaveBeenCalledWith('https://example.invalid/?kiosk=1#player');
});

it('reloads an ordinary address without changing it', () => {
  const assign = vi.fn();
  vi.stubGlobal('location', { href: 'https://example.invalid/', assign });
  reloadSettings();
  expect(assign).toHaveBeenCalledWith('https://example.invalid/');
});
