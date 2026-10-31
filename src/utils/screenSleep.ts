// The kiosk's screen sleep. The app decides when the screen may sleep: never while music plays, otherwise after a few
// idle minutes. While it must stay on, the app holds a screen wake lock, which Chromium passes to Cage as an idle
// inhibitor. Once the app lets go and shows its black sleep screen, the Pi's swayidle turns the HDMI output off, and the
// first touch turns it back on (ansible/roles/kiosk/files/bin/kiosk-display). Storage can be unavailable: every access
// tolerates that.

import { kioskPost } from './kioskService';

const SCREEN_SLEEP_KEY = 'maxmix.screenSleep';

/** The choices the settings offer, in minutes; 0 keeps the screen on. */
export const SCREEN_SLEEP_CHOICES = [0, 2, 5, 15, 30] as const;
export type ScreenSleepMinutes = (typeof SCREEN_SLEEP_CHOICES)[number];
const DEFAULT_SCREEN_SLEEP: ScreenSleepMinutes = 5;

function isChoice(value: number): value is ScreenSleepMinutes {
  return (SCREEN_SLEEP_CHOICES as readonly number[]).includes(value);
}

/** Minutes without a touch, with nothing playing, before the kiosk's screen sleeps; 0 for never. */
export function getScreenSleep(): ScreenSleepMinutes {
  try {
    const stored = localStorage.getItem(SCREEN_SLEEP_KEY);
    if (stored === null) return DEFAULT_SCREEN_SLEEP;
    const minutes = Number(stored);
    return isChoice(minutes) ? minutes : DEFAULT_SCREEN_SLEEP;
  } catch {
    return DEFAULT_SCREEN_SLEEP;
  }
}

export function setScreenSleep(minutes: ScreenSleepMinutes): void {
  try {
    if (minutes === DEFAULT_SCREEN_SLEEP) localStorage.removeItem(SCREEN_SLEEP_KEY);
    else localStorage.setItem(SCREEN_SLEEP_KEY, String(minutes));
  } catch {
    // Storage is unavailable; the setting then lasts only until the page reloads.
  }
}

/** Asks the kiosk to turn its screen back on, for music that starts while it sleeps (from a phone, say). */
export function wakeDisplay(): void {
  kioskPost('/display/wake');
}
