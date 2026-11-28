import type { CSSProperties } from 'react';
import { Lightbulb, LightbulbOff, Power } from 'lucide-react';
import type { Lights } from '../hooks/useLights';
import type { StringId } from '../i18n/strings';
import { useT } from '../i18n/translate';
import type { Light, LightsPhase } from '../lights/kiosk';

/** What to say in place of the lights while they can't be switched. */
const NOTICES: Partial<Record<LightsPhase, StringId>> = {
  'signed-out': 'lights.signed_out',
  connecting: 'lights.connecting',
  unreachable: 'lights.unreachable'
};

/**
 * One light: a tall column that fills as it brightens, as the screen's own brightness does in Settings. A light that
 * dims is dragged up and down anywhere on it; the button under it turns the light on and off.
 */
function LightColumn({ light, onChange }: Readonly<{ light: Light; onChange: Lights['change'] }>) {
  const t = useT();
  // A light that is on and does not say how bright (it does not dim) fills the column.
  const level = light.on ? (light.brightness ?? 100) : 0;
  const Icon = light.on ? Lightbulb : LightbulbOff;
  const labelId = `light-${light.id}`;
  // A light Home Assistant can't reach says nothing; one that dims says how bright it is.
  const onValue = light.dimmable ? `${level}%` : t('common.on');
  const stateValue = light.on ? onValue : t('common.off');
  const value = light.available ? stateValue : '–';
  return (
    <li className="light" data-on={light.on || undefined} data-unavailable={!light.available || undefined}>
      <div className="light-column" style={{ '--level': `${level}%` } as CSSProperties}>
        <span className="light-fill" aria-hidden="true" />
        <Icon className="light-icon" aria-hidden="true" />
        <output className="light-value">{value}</output>
        {light.dimmable && light.available && (
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={level}
            aria-label={t('lights.brightness', { name: light.name })}
            onChange={event => onChange(light, { brightness: Number(event.target.value) })}
            className="light-range"
          />
        )}
      </div>
      <button
        type="button"
        className="light-power"
        aria-pressed={light.on}
        aria-labelledby={labelId}
        disabled={!light.available}
        onClick={() => onChange(light, { on: !light.on })}
      >
        <Power className="lucide" aria-hidden="true" />
      </button>
      <span className="light-name" id={labelId}>
        {light.name}
      </span>
    </li>
  );
}

/** The Lights tab: the lights the kiosk's owner allowed, each to turn on, off and (where it dims) up and down. */
export default function LightsView({ status, change, signIn }: Readonly<Lights>) {
  const t = useT();
  if (!status) return null;
  const notice = NOTICES[status.state] ?? (status.lights.length === 0 ? 'lights.none' : null);
  return (
    <main className="lights-view">
      {notice ? (
        <div className="lights-notice">
          <p role="status">{t(notice)}</p>
          {status.state === 'signed-out' && (
            <button type="button" className="button" onClick={signIn}>
              {t('lights.sign_in')}
            </button>
          )}
        </div>
      ) : (
        <ul className="lights-list">
          {status.lights.map(light => (
            <LightColumn key={light.id} light={light} onChange={change} />
          ))}
        </ul>
      )}
    </main>
  );
}
