import type { CSSProperties } from 'react';
import { Sun } from 'lucide-react';
import { BRIGHTNESS_MAX, BRIGHTNESS_MIN, BRIGHTNESS_STEP } from '../../utils/backlight';
import { useT } from '../../i18n/translate';

/**
 * How bright the kiosk's screen is in use, on a panel whose backlight the Pi can set (utils/backlight): a tall column
 * that fills as it brightens, dragged up and down anywhere on it. Every step is passed on at once, so the screen itself
 * follows the finger.
 */
export default function BrightnessSettings({
  percent,
  onChange
}: Readonly<{ percent: number; onChange: (percent: number) => void }>) {
  const t = useT();
  const progress = ((percent - BRIGHTNESS_MIN) / (BRIGHTNESS_MAX - BRIGHTNESS_MIN)) * 100;
  return (
    <section className="brightness-setting" aria-labelledby="brightness-label">
      <h5 className="sr-only" id="brightness-label">
        {t('general.brightness')}
      </h5>
      <div className="brightness-column" style={{ '--brightness': `${progress}%` } as CSSProperties}>
        <span className="brightness-fill" aria-hidden="true" />
        <Sun className="brightness-sun" aria-hidden="true" />
        <output className="brightness-value">{percent}%</output>
        <input
          type="range"
          min={BRIGHTNESS_MIN}
          max={BRIGHTNESS_MAX}
          step={BRIGHTNESS_STEP}
          value={percent}
          aria-labelledby="brightness-label"
          onChange={event => onChange(Number(event.target.value))}
          className="brightness-range"
        />
      </div>
    </section>
  );
}
