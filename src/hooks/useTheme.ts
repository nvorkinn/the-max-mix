import { useEffect, useState } from 'react';
import { getKioskLocation } from '../utils/kiosk';
import { sunTimes } from '../utils/sun';
import { loadTheme, saveTheme } from '../utils/theme';
import type { Skin, Theme } from '../utils/theme';

/** How often Auto looks at the clock. A minute late at sunrise is fine, and it copes with sleep and clock changes. */
const AUTO_CHECK_MS = 60_000;

/** Day between sunrise and sunset, Night otherwise; Day on a day the sun does not rise or set. */
export function skinAt(now: Date, place: { lat: number; lon: number }): Skin {
  const sun = sunTimes(now, place.lat, place.lon);
  if (!sun) return 'day';
  return now >= sun.sunrise && now < sun.sunset ? 'day' : 'night';
}

/**
 * The skin the settings picked, kept across reloads, and the one on screen (`skin`, which goes on .tablet-container as
 * `data-theme`). Auto is offered only when the kiosk knows where it is; a stored Auto without a location shows Day.
 */
export function useTheme(): {
  theme: Theme;
  skin: Skin;
  autoOffered: boolean;
  change: (theme: Theme) => void;
} {
  const [theme, setTheme] = useState(loadTheme);
  const [place] = useState(getKioskLocation);
  const auto = theme === 'auto' && place !== null;
  // The time Auto last looked at, moved on every minute and when the screen comes back, so a skin change re-renders.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!auto) return;
    const tick = () => {
      setNow(Date.now());
    };
    const timer = setInterval(tick, AUTO_CHECK_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [auto]);

  const change = (next: Theme) => {
    setNow(Date.now());
    setTheme(next);
    saveTheme(next);
  };
  let skin: Skin = 'day';
  if (theme === 'auto' && place) skin = skinAt(new Date(now), place);
  else if (theme !== 'auto') skin = theme;
  return { theme: theme === 'auto' && !place ? 'day' : theme, skin, autoOffered: place !== null, change };
}
