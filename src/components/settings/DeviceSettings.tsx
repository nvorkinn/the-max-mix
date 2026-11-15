import { ExternalLink } from 'lucide-react';
import { configEmbedEnabled, configSiteUrl } from '../../countdown/server';
import QrCode from '../QrCode';

/**
 * This device's settings, which countdown-server keeps: its config site shown inside the page once the site's embedded
 * mode is live. Until then, the site's address as a QR code for a phone (and, off the kiosk, as a link), since a tap on
 * the kiosk would take its only window away from the app.
 */
export default function DeviceSettings({ deviceId, kiosk }: Readonly<{ deviceId: string | null; kiosk: boolean }>) {
  const site = configSiteUrl(deviceId);
  if (!site) return null;
  const embedded = configEmbedEnabled() ? configSiteUrl(deviceId, true) : null;

  if (embedded) {
    return (
      <iframe
        src={embedded}
        title="Device settings"
        className="settings-embed"
        // The site's sign-in is a passkey, which a cross-origin frame may only ask for when allowed to. The sandbox keeps
        // it from taking the kiosk's window away from the app.
        allow="publickey-credentials-get; publickey-credentials-create"
        // eslint-disable-next-line @eslint-react/dom-no-unsafe-iframe-sandbox -- The site is another origin, so scripts there can't lift the sandbox.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    );
  }

  return (
    <div className="settings-box settings-site">
      <QrCode text={site} className="settings-site-qr" />
      {kiosk ? (
        <span className="settings-site-address">{site}</span>
      ) : (
        <a href={site} target="_blank" rel="noreferrer" className="button button-secondary settings-wide-button">
          <ExternalLink className="w-5 h-5 shrink-0" aria-hidden="true" />
          {site}
        </a>
      )}
    </div>
  );
}
