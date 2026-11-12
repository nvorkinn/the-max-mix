// Sunrise and sunset for the Auto theme, worked out on the device with no network: the sunrise equation (as on
// Wikipedia's "Sunrise equation", good to a minute or two away from the poles). The day is the local calendar day of
// the given date in the browser's time zone, which on the kiosk is the Pi's own (Ansible's kiosk_timezone).

const J2000 = 2_451_545;
const UNIX_EPOCH_JULIAN = 2_440_587.5;
const DAY_MS = 86_400_000;
const rad = Math.PI / 180;

const toJulian = (time: number) => time / DAY_MS + UNIX_EPOCH_JULIAN;
const fromJulian = (julian: number) => new Date((julian - UNIX_EPOCH_JULIAN) * DAY_MS);

/**
 * Sunrise and sunset on the local calendar day of `day` at latitude `lat` and longitude `lon` (degrees, east positive),
 * or null when the sun does not rise or does not set that day (polar night or midnight sun).
 */
export function sunTimes(day: Date, lat: number, lon: number): { sunrise: Date; sunset: Date } | null {
  // Noon UTC of the local date, so the solar noon found below is the one of that local day.
  const noon = toJulian(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 12));
  const n = Math.round(noon - J2000 + 0.0008);
  const meanNoon = n - lon / 360;
  const anomaly = (357.5291 + 0.98560028 * meanNoon) % 360;
  const centre =
    1.9148 * Math.sin(anomaly * rad) + 0.02 * Math.sin(2 * anomaly * rad) + 0.0003 * Math.sin(3 * anomaly * rad);
  const longitude = (anomaly + centre + 180 + 102.9372) % 360;
  const transit = J2000 + meanNoon + 0.0053 * Math.sin(anomaly * rad) - 0.0069 * Math.sin(2 * longitude * rad);
  const declination = Math.asin(Math.sin(longitude * rad) * Math.sin(23.4397 * rad));
  const cosHourAngle =
    (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(declination)) /
    (Math.cos(lat * rad) * Math.cos(declination));
  // Beyond ±1 (or NaN at a pole) the sun stays up or down all day.
  if (Number.isNaN(cosHourAngle) || Math.abs(cosHourAngle) > 1) return null;
  const hourAngle = Math.acos(cosHourAngle) / rad;
  return { sunrise: fromJulian(transit - hourAngle / 360), sunset: fromJulian(transit + hourAngle / 360) };
}
