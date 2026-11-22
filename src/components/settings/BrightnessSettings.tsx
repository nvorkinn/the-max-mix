import type { CSSProperties } from 'react';
import { Sun } from 'lucide-react';
import { BRIGHTNESS_MAX, BRIGHTNESS_MIN, BRIGHTNESS_STEP } from '../../utils/backlight';
import { useT } from '../../i18n/translate';

/**
 * How bright the kiosk's screen is in use, on a panel whose backlight the Pi can set (utils/backlight). Every step of the
 * slider is passed on at once, so the screen follows the finger.
 */
export default function BrightnessSettings({
  percent,
  onChange
}: Readonly<{ percent: number; onChange: (percent: number) => void }>) {
  const t = useT();
  const progress = ((percent - BRIGHTNESS_MIN) / (BRIGHTNESS_MAX - BRIGHTNESS_MIN)) * 100;
  return (
    <section className="settings-group">
      <h5 className="settings-group-title" id="brightness-label">
        {t('general.brightness')}
      </h5>
      <div className="brightness-setting">
        <Sun className="w-5 h-5 shrink-0" aria-hidden="true" />
        <input
          type="range"
          min={BRIGHTNESS_MIN}
          max={BRIGHTNESS_MAX}
          step={BRIGHTNESS_STEP}
          value={percent}
          aria-labelledby="brightness-label"
          onChange={event => onChange(Number(event.target.value))}
          className="range-control brightness-range"
          style={{ '--range-progress': `${progress}%` } as CSSProperties}
        />
        <output className="brightness-value">{percent}%</output>
      </div>
    </section>
  );
}
