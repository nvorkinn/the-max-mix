// The pages of the settings, in the order the navigation lists them; the settings open on the first shown. General and
// Countdown show once someone owns the kiosk (what they set is kept only on countdown-server). Screen, the kiosk's
// only, is its screen's brightness, sleep and quiet hours. Each setting shows once: the ones countdown-server keeps
// save there (hooks/useDeviceConfig.ts), Wi-Fi and the software stay local.
// Notices, only once someone owns the kiosk, is what the notice board says: the owner's deliveries (Parcels) and how
// soon it mentions the next bank holiday. Appearance is
// the colours and how synced lyrics look. Spotify is who can play here. About says what the screen is and runs its software updates. Each page's name is in i18n/strings.ts
// (settings.<id>); `label` is its English one.

export const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', kioskOnly: false },
  { id: 'wifi', label: 'Wi-Fi', kioskOnly: true },
  { id: 'countdown', label: 'Countdown', kioskOnly: false },
  { id: 'screen', label: 'Screen', kioskOnly: true },
  { id: 'appearance', label: 'Appearance', kioskOnly: false },
  { id: 'spotify', label: 'Spotify', kioskOnly: false },
  { id: 'notices', label: 'Notices', kioskOnly: false },
  { id: 'about', label: 'About', kioskOnly: false }
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];
