// The tablet's own words, by id, in each language it speaks: ICU MessageFormat strings, read with t() (translate.ts).
// The notice board's words are countdown-api's (dashboard/messages.ts), shared with the e-paper screens; these are the
// tablet's alone. A language's name is always written in that language, so it is not here.

import type { Language } from './language';

export const STRINGS = {
  // The Settings tab's pages, by their id (components/settings/sections.ts).
  'settings.title': { en: 'Settings', nb: 'Innstillinger' },
  'settings.general': { en: 'General', nb: 'Generelt' },
  'settings.countdown': { en: 'Countdown', nb: 'Countdown' },
  'settings.parcels': { en: 'Parcels', nb: 'Pakker' },
  'settings.appearance': { en: 'Appearance', nb: 'Utseende' },
  'settings.wifi': { en: 'Wi-Fi', nb: 'Wi-Fi' },
  'settings.spotify': { en: 'Spotify', nb: 'Spotify' },
  'settings.lyrics': { en: 'Lyrics', nb: 'Sangtekster' },
  'settings.about': { en: 'About', nb: 'Om' },
  'settings.saved': { en: 'Saved', nb: 'Lagret' },
  'settings.not_saved': { en: 'Not saved', nb: 'Ikke lagret' },

  // Words every page uses.
  'common.change': { en: 'Change', nb: 'Endre' },
  'common.cancel': { en: 'Cancel', nb: 'Avbryt' },
  'common.save': { en: 'Save', nb: 'Lagre' },
  'common.on': { en: 'On', nb: 'På' },
  'common.off': { en: 'Off', nb: 'Av' },
  'common.results': { en: 'Results', nb: 'Resultater' },
  'common.added': { en: 'Added', nb: 'Lagt til' },
  'common.nothing_found': { en: 'Nothing found.', nb: 'Fant ingenting.' },

  // Settings › General.
  'general.language': { en: 'Language', nb: 'Språk' },
  'general.time_format': { en: 'Time format', nb: 'Tidsformat' },
  'general.24h': { en: '24-hour', nb: '24 timer' },
  'general.12h': { en: '12-hour', nb: '12 timer' },
  'general.weather': { en: 'Weather', nb: 'Vær' },
  'general.no_place': { en: 'No place', nb: 'Ikke valgt' },
  'general.weather_place': { en: 'Weather place', nb: 'Sted for været' },
  'general.postcode': { en: 'Postcode', nb: 'Postnummer' },
  'general.postcode_hint': {
    en: 'A UK or Norwegian postcode. Leave it empty for none.',
    nb: 'Et norsk eller britisk postnummer. La feltet stå tomt for ingen.'
  },
  'general.postcode_wrong': {
    en: 'Enter a UK or Norwegian postcode.',
    nb: 'Skriv et norsk eller britisk postnummer.'
  },
  'general.locating': { en: 'Locating...', nb: 'Finner posisjonen...' },
  'general.current_location': { en: 'Current location', nb: 'Nåværende posisjon' },
  'general.location_failed': {
    en: "Couldn't find the current location.",
    nb: 'Fant ikke den nåværende posisjonen.'
  },
  'general.screen_sleep': { en: 'Screen sleep', nb: 'Hvilemodus' },
  'general.never': { en: 'Never', nb: 'Aldri' },
  'general.minutes': { en: '{minutes} min', nb: '{minutes} min' },
  'general.quiet_hours': { en: 'Quiet hours', nb: 'Stille timer' },
  'general.from': { en: 'From', nb: 'Fra' },
  'general.to': { en: 'To', nb: 'Til' },
  'country.GB': { en: 'United Kingdom', nb: 'Storbritannia' },
  'country.NO': { en: 'Norway', nb: 'Norge' }
} as const satisfies Record<string, Readonly<Record<Language, string>>>;

/** An id STRINGS has: any other is a compile error. */
export type StringId = keyof typeof STRINGS;
