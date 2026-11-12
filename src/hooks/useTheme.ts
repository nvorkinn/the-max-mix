import { useState } from 'react';
import { loadTheme, saveTheme } from '../utils/theme';
import type { Theme } from '../utils/theme';

/** The skin the settings picked, kept across reloads. Its value goes on .tablet-container as `data-theme`. */
export function useTheme(): { theme: Theme; change: (theme: Theme) => void } {
  const [theme, setTheme] = useState(loadTheme);
  const change = (next: Theme) => {
    setTheme(next);
    saveTheme(next);
  };
  return { theme, change };
}
