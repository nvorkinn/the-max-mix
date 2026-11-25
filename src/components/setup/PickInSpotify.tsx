import { Check, MonitorSpeaker, Smartphone, Speaker } from 'lucide-react';
import { useT } from '../../i18n/translate';

/**
 * A drawing of what to do in Spotify on the phone, played over and over: tap the devices button on the bar of what
 * plays, then this kiosk in the list that comes up. It is drawn in the app's own style, not a picture of Spotify's app.
 * With reduced motion it stays on the end: the list, with the kiosk picked. The line over it says the same in words, so
 * the drawing is hidden from screen readers.
 */
export default function PickInSpotify({ device }: Readonly<{ device: string }>) {
  const t = useT();
  return (
    <div className="spotify-pick" aria-hidden="true">
      <div className="spotify-pick-tiles">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="spotify-pick-bar">
        <span className="spotify-pick-cover" />
        <span className="spotify-pick-song" />
        <MonitorSpeaker className="spotify-pick-devices" />
      </div>
      <span className="spotify-pick-tap spotify-pick-tap-devices" />
      <div className="spotify-pick-sheet">
        <div className="spotify-pick-row">
          <Smartphone />
          <span>{t('setup.this_phone')}</span>
        </div>
        <div className="spotify-pick-row spotify-pick-kiosk">
          <Speaker />
          <span>{device}</span>
          <Check className="spotify-pick-tick" />
        </div>
        <span className="spotify-pick-tap spotify-pick-tap-kiosk" />
      </div>
    </div>
  );
}
