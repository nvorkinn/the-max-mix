// The pages of the settings, in the order the navigation lists them. Overview is where the settings open. Device is
// countdown-server's config site for this kiosk, shown only when the build names a server.

export const SETTINGS_SECTIONS = [
  { id: 'overview', label: 'Overview', kioskOnly: false },
  { id: 'device', label: 'Device', kioskOnly: false },
  { id: 'appearance', label: 'Appearance', kioskOnly: false },
  { id: 'sleep', label: 'Screen sleep', kioskOnly: true },
  { id: 'wifi', label: 'Wi-Fi', kioskOnly: true },
  { id: 'spotify', label: 'Spotify', kioskOnly: false },
  { id: 'software', label: 'Software', kioskOnly: false }
  // The local pages other than Wi-Fi go once the Device page shows the config site embedded: the server's settings
  // replace them, so they are not to be extended meanwhile.
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];
