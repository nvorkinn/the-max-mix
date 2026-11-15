// The pages of the settings, in the order the navigation lists them. Overview is where the settings open; General and
// Dashboard show once someone owns the kiosk, since their settings are kept only on countdown-server. Each setting
// shows once: the ones countdown-server keeps save there (hooks/useDeviceConfig.ts), Wi-Fi and software stay local.

export const SETTINGS_SECTIONS = [
  { id: 'overview', label: 'Overview', kioskOnly: false },
  { id: 'general', label: 'General', kioskOnly: false },
  { id: 'dashboard', label: 'Dashboard', kioskOnly: false },
  { id: 'appearance', label: 'Appearance', kioskOnly: false },
  { id: 'sleep', label: 'Screen sleep', kioskOnly: true },
  { id: 'wifi', label: 'Wi-Fi', kioskOnly: true },
  { id: 'spotify', label: 'Spotify', kioskOnly: false },
  { id: 'software', label: 'Software', kioskOnly: false }
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];
