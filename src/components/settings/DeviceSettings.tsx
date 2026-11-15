import { configSiteUrl } from '../../countdown/server';

/** This device's settings, which countdown-server keeps: its config site, in its embedded mode, filling the page. */
export default function DeviceSettings({ deviceId }: Readonly<{ deviceId: string | null }>) {
  const site = configSiteUrl(deviceId);
  if (!site) return null;
  return (
    <iframe
      src={site}
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
