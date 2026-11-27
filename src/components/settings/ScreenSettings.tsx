import type { ClockFormat } from '../../utils/clockFormat';
import type { QuietHours } from '../../utils/quietHours';
import type { ScreenSleepMinutes } from '../../utils/screenSleep';
import BrightnessSettings from './BrightnessSettings';
import QuietHoursSettings from './QuietHoursSettings';
import ScreenSleepSettings from './ScreenSleepSettings';

/**
 * The kiosk's own screen: how bright it is (on a panel whose backlight the Pi can set), how soon it sleeps, and its quiet
 * hours. A browser has no screen of its own to dim or put to sleep, so only the kiosk has this page.
 */
export default function ScreenSettings({
  brightness,
  onBrightnessChange,
  screenSleep,
  onScreenSleepChange,
  quietHours,
  onQuietHoursChange,
  clockFormat
}: Readonly<{
  brightness?: number | undefined;
  onBrightnessChange?: ((percent: number) => void) | undefined;
  screenSleep: ScreenSleepMinutes;
  onScreenSleepChange: (minutes: ScreenSleepMinutes) => void;
  quietHours?: QuietHours | undefined;
  onQuietHoursChange?: ((hours: QuietHours) => void) | undefined;
  clockFormat: ClockFormat;
}>) {
  // The night and the day read top to bottom on the left; brightness stands beside them both as one tall column.
  return (
    <div className="screen-settings">
      <div className="settings-stack">
        {quietHours && onQuietHoursChange && (
          <QuietHoursSettings hours={quietHours} clockFormat={clockFormat} onChange={onQuietHoursChange} />
        )}
        <ScreenSleepSettings minutes={screenSleep} onChange={onScreenSleepChange} />
      </div>
      {brightness !== undefined && onBrightnessChange && (
        <BrightnessSettings percent={brightness} onChange={onBrightnessChange} />
      )}
    </div>
  );
}
