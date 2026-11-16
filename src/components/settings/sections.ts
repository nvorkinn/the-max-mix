// The pages of the settings, in the order the navigation lists them. Overview is where the settings open. General shows
// once someone owns the kiosk (its time format, weather and notice board are kept only on countdown-server) or on the
// kiosk (its screen sleep); Countdown only once someone owns it. Each setting shows once: the ones countdown-server keeps
// save there (hooks/useDeviceConfig.ts), Wi-Fi and the software stay local.
// About says what the screen is and runs its software updates.

export const SETTINGS_SECTIONS = [
  { id: 'overview', label: 'Overview', kioskOnly: false },
  { id: 'general', label: 'General', kioskOnly: false },
  { id: 'countdown', label: 'Countdown', kioskOnly: false },
  { id: 'appearance', label: 'Appearance', kioskOnly: false },
  { id: 'wifi', label: 'Wi-Fi', kioskOnly: true },
  { id: 'spotify', label: 'Spotify', kioskOnly: false },
  { id: 'about', label: 'About', kioskOnly: false }
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];
