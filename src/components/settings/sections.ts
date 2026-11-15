// The pages of the settings, in the order the navigation lists them. Overview is where the settings open.

export const SETTINGS_SECTIONS = [
  { id: 'overview', label: 'Overview', kioskOnly: false },
  { id: 'appearance', label: 'Appearance', kioskOnly: false },
  { id: 'sleep', label: 'Screen sleep', kioskOnly: true },
  { id: 'wifi', label: 'Wi-Fi', kioskOnly: true },
  { id: 'spotify', label: 'Spotify', kioskOnly: false },
  { id: 'software', label: 'Software', kioskOnly: false }
  // PLACEHOLDER: the device settings that countdown-server will send go here, as sections of their own, once the app
  // reads its config from the server. The old Spotify settings are not to be extended meanwhile: the server's replace them.
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];
