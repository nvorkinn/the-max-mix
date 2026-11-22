import type { Parcels } from 'countdown-api';
import { Package } from 'lucide-react';
import { connectParcelPageUrl } from '../../../vendor/countdown-api/src/countdown_api/client';
import { countdownServer } from '../../countdown/server';
import QrCode from '../QrCode';
import { useT } from '../../i18n/translate';
import type { StringId } from '../../i18n/strings';
import SettingsToggle from './SettingsToggle';

type DaysAhead = NonNullable<Parcels['days_ahead']> | null;
type KeptHours = NonNullable<Parcels['kept_hours']>;
/** A choice's words: a string's id, and its arguments. */
type Label = readonly [StringId, Record<string, number>?];

/** The settings site's "Arriving by", as the e-paper screens have it: which dated parcels show, by their due day. */
const DAYS_AHEAD_CHOICES: readonly { value: DaysAhead; label: Label }[] = [
  { value: 0, label: ['parcels.today'] },
  { value: 1, label: ['parcels.tomorrow'] },
  { value: 2, label: ['parcels.day_after'] },
  { value: null, label: ['parcels.any_day'] }
];

const KEPT_HOURS_CHOICES: readonly { value: KeptHours; label: Label }[] = [
  { value: 0, label: ['parcels.not_kept'] },
  { value: 1, label: ['parcels.hours', { hours: 1 }] },
  { value: 4, label: ['parcels.hours', { hours: 4 }] },
  { value: 24, label: ['parcels.a_day'] }
];

/** How long a delivered parcel stays when the config doesn't say (the server's default). */
const DEFAULT_KEPT_HOURS: KeptHours = 4;

function Segmented<T>({
  id,
  title,
  choices,
  selected,
  onSelect
}: Readonly<{
  id: string;
  title: string;
  choices: readonly { value: T; label: Label }[];
  selected: T;
  onSelect: (value: T) => void;
}>) {
  const t = useT();
  return (
    <section className="settings-group">
      <h5 className="settings-group-title" id={id}>
        {title}
      </h5>
      <div className="settings-segmented" role="group" aria-labelledby={id}>
        {choices.map(choice => (
          <button
            type="button"
            key={String(choice.value)}
            aria-pressed={selected === choice.value}
            onClick={() => onSelect(choice.value)}
            className="settings-segment"
          >
            {t(...choice.label)}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * What the Parcels page shows while the owner's account has no Parcel API key: how to get one, and a code that opens the
 * settings site's page for it (countdown-api's connectParcelPage), which says where the key is and takes it pasted.
 */
function ParcelsSetup() {
  const t = useT();
  const site = countdownServer();
  return (
    <section className="settings-box parcels-setup" aria-labelledby="parcels-setup-label">
      <div className="parcels-setup-text">
        <h5 className="settings-group-title parcels-setup-title" id="parcels-setup-label">
          <Package className="w-6 h-6" aria-hidden="true" />
          {t('parcels.set_up')}
        </h5>
        <ol className="parcels-setup-steps">
          <li>{t('parcels.step_premium')}</li>
          <li>{t('parcels.step_key')}</li>
          <li>{t('parcels.step_scan')}</li>
        </ol>
      </div>
      {site && <QrCode text={connectParcelPageUrl(site).href} className="parcels-setup-qr" />}
    </section>
  );
}

/**
 * The Parcels page: whether the notice board has the owner's Parcel deliveries, which ones by the day they're due, and how
 * long delivered ones stay, as the settings site has them for the e-paper screens. The Parcel key is the owner's account's,
 * on the settings site, so the page shows only once someone owns the kiosk, and each tap saves the whole of it to
 * countdown-server.
 */
export default function ParcelsSettings({
  parcels,
  keySaved = true,
  onChange
}: Readonly<{
  parcels: Parcels | null | undefined;
  /**
   * Whether the owner's account has a Parcel API key (countdown-server's getAccount, as the Settings tab asks it);
   * without one the page only says how to set Parcel up.
   */
  keySaved?: boolean;
  onChange: (parcels: Parcels) => void;
}>) {
  const t = useT();
  if (!keySaved) return <ParcelsSetup />;
  // A config from before parcels has none, which is off.
  const current: Parcels = parcels ?? { enabled: false };
  return (
    <div className="settings-stack">
      <SettingsToggle
        id="parcels-notices-label"
        title={t('parcels.notice_board')}
        on={current.enabled}
        onChange={enabled => onChange({ ...current, enabled })}
      />
      <Segmented
        id="parcels-days-ahead-label"
        title={t('parcels.arriving_by')}
        choices={DAYS_AHEAD_CHOICES}
        selected={current.days_ahead ?? null}
        onSelect={days_ahead => onChange({ ...current, days_ahead })}
      />
      <Segmented
        id="parcels-kept-hours-label"
        title={t('parcels.delivered_stay')}
        choices={KEPT_HOURS_CHOICES}
        selected={current.kept_hours ?? DEFAULT_KEPT_HOURS}
        onSelect={kept_hours => onChange({ ...current, kept_hours })}
      />
    </div>
  );
}
