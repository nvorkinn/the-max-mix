import type { Parcels } from 'countdown-api';
import { Package } from 'lucide-react';
import { countdownServer } from '../../countdown/server';
import QrCode from '../QrCode';

type DaysAhead = NonNullable<Parcels['days_ahead']> | null;
type KeptHours = NonNullable<Parcels['kept_hours']>;

const NOTICE_CHOICES = [
  { value: false, label: 'Off' },
  { value: true, label: 'On' }
] as const;

/** The settings site's "Arriving by", as the e-paper screens have it: which dated parcels show, by their due day. */
const DAYS_AHEAD_CHOICES: readonly { value: DaysAhead; label: string }[] = [
  { value: 0, label: 'Today' },
  { value: 1, label: 'Tomorrow' },
  { value: 2, label: 'Day after' },
  { value: null, label: 'Any day' }
];

const KEPT_HOURS_CHOICES: readonly { value: KeptHours; label: string }[] = [
  { value: 0, label: 'Not kept' },
  { value: 1, label: '1 hour' },
  { value: 4, label: '4 hours' },
  { value: 24, label: 'A day' }
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
  choices: readonly { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}>) {
  return (
    <section className="settings-group">
      <h5 className="settings-group-title" id={id}>
        {title}
      </h5>
      <div className="settings-segmented" role="group" aria-labelledby={id}>
        {choices.map(choice => (
          <button
            type="button"
            key={choice.label}
            aria-pressed={selected === choice.value}
            onClick={() => onSelect(choice.value)}
            className="settings-segment"
          >
            {choice.label}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * What the Parcels page shows while the owner's account has no Parcel API key: how to get one, and a code that opens the
 * settings site's account page, where it is entered.
 */
function ParcelsSetup() {
  const site = countdownServer();
  return (
    <section className="settings-box parcels-setup" aria-labelledby="parcels-setup-label">
      <div className="parcels-setup-text">
        <h5 className="settings-group-title parcels-setup-title" id="parcels-setup-label">
          <Package className="w-6 h-6" aria-hidden="true" />
          Set up Parcel
        </h5>
        <ol className="parcels-setup-steps">
          <li>Get Parcel Premium in the Parcel app</li>
          <li>Copy your API key from web.parcelapp.net</li>
          <li>Scan the code and paste the key under Parcel</li>
        </ol>
      </div>
      {site && <QrCode text={`${site}/account`} className="parcels-setup-qr" />}
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
  if (!keySaved) return <ParcelsSetup />;
  // A config from before parcels has none, which is off.
  const current: Parcels = parcels ?? { enabled: false };
  return (
    <div className="settings-stack">
      <Segmented
        id="parcels-notices-label"
        title="Notice board"
        choices={NOTICE_CHOICES}
        selected={current.enabled}
        onSelect={enabled => onChange({ ...current, enabled })}
      />
      <Segmented
        id="parcels-days-ahead-label"
        title="Arriving by"
        choices={DAYS_AHEAD_CHOICES}
        selected={current.days_ahead ?? null}
        onSelect={days_ahead => onChange({ ...current, days_ahead })}
      />
      <Segmented
        id="parcels-kept-hours-label"
        title="Delivered ones stay"
        choices={KEPT_HOURS_CHOICES}
        selected={current.kept_hours ?? DEFAULT_KEPT_HOURS}
        onSelect={kept_hours => onChange({ ...current, kept_hours })}
      />
    </div>
  );
}
