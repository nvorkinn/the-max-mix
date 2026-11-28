// The kiosk screen's backlight, on a panel that has one (a DSI panel; an HDMI screen has none). The kiosk says which at
// registration, and countdown-server sends it back in the config as `brightness_control`. With one, the brightness
// setting (the config's display.brightness) is how bright the screen is in use, and an idle Dashboard dims by turning
// the backlight down. Without one there is no setting, and it dims by darkening the page (components/SleepScreen).

import type { TouchscreenConfig } from 'countdown-api';
import { kioskPost } from './kioskService';

/** The brightness setting's range and step, in percent; the contract's lowest and highest. */
export const BRIGHTNESS_MIN = 10;
export const BRIGHTNESS_MAX = 100;
export const BRIGHTNESS_STEP = 5;

/** How much of its set brightness a dimmed screen keeps. */
const DIMMED_SHARE = 0.3;
/** How bright a screen dimmed in quiet hours is, whatever its setting: the lowest the backlight goes, for a dark room. */
const QUIET_DIMMED = 1;

/** The brightness setting of a config's display, in percent; full for one from a server that predates the setting. */
export function brightnessOf(display: TouchscreenConfig['display']): number {
  const { brightness } = display as { brightness?: unknown };
  return typeof brightness === 'number' && brightness >= BRIGHTNESS_MIN && brightness <= BRIGHTNESS_MAX
    ? Math.round(brightness)
    : BRIGHTNESS_MAX;
}

/** The backlight of a dimmed screen whose setting is `percent`: a share of it, or in `quiet` hours the lowest; never off. */
export function dimmedBrightness(percent: number, quiet = false): number {
  return quiet ? QUIET_DIMMED : Math.max(1, Math.round(percent * DIMMED_SHARE));
}

/** Asks the kiosk to set its screen's backlight (server/src/backlight.ts), fading down to it with `fade`. */
export function setBacklight(percent: number, fade = false): void {
  kioskPost('/display/brightness', fade ? { percent, fade } : { percent });
}
