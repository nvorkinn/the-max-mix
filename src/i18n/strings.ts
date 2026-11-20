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
  'country.NO': { en: 'Norway', nb: 'Norge' },

  // The tab bar.
  'tabs.screens': { en: 'Screens', nb: 'Skjermer' },
  'tabs.spotify': { en: 'Spotify', nb: 'Spotify' },
  'tabs.dashboard': { en: 'Dashboard', nb: 'Oversikt' },
  'tabs.settings': { en: 'Settings', nb: 'Innstillinger' },
  'tabs.choose_music': { en: 'Choose music', nb: 'Velg musikk' },
  'tabs.signed_in_as': { en: 'Signed in as {name}', nb: 'Logget inn som {name}' },

  // The Dashboard.
  'dashboard.now_playing': { en: 'Now playing', nb: 'Spilles nå' },
  'dashboard.previous': { en: 'Previous', nb: 'Forrige' },
  'dashboard.play': { en: 'Play', nb: 'Spill av' },
  'dashboard.pause': { en: 'Pause', nb: 'Pause' },
  'dashboard.next': { en: 'Next', nb: 'Neste' },
  'dashboard.close': { en: 'Close', nb: 'Lukk' },
  'dashboard.notice_board': { en: 'Notice board', nb: 'Oppslagstavle' },
  'dashboard.tube_status': { en: 'Tube status', nb: 'Status for Tube' },
  'dashboard.disruptions': { en: 'Disruptions', nb: 'Avvik' },
  'dashboard.hourly_forecast': { en: 'Hourly forecast', nb: 'Time for time' },
  'dashboard.next_days': { en: 'Next days', nb: 'De neste dagene' },
  'board.due': { en: 'Due', nb: 'Nå' },
  'board.platform': { en: 'Platform {platform}', nb: 'Spor {platform}' },
  'board.stop': { en: 'Stop {letter}', nb: 'Plattform {letter}' },

  // The weather.
  'weather.now': { en: 'Now', nb: 'Nå' },
  'weather.tonight': { en: 'Tonight', nb: 'I kveld' },
  'weather.tomorrow': { en: 'Tomorrow', nb: 'I morgen' },
  'weather.weekend': { en: 'Weekend', nb: 'Helgen' },
  'weather.clear': { en: 'Clear', nb: 'Klart' },
  'weather.mostly_clear': { en: 'Mostly clear', nb: 'Lettskyet' },
  'weather.partly_cloudy': { en: 'Partly cloudy', nb: 'Delvis skyet' },
  'weather.cloudy': { en: 'Cloudy', nb: 'Skyet' },
  'weather.fog': { en: 'Fog', nb: 'Tåke' },
  'weather.drizzle': { en: 'Drizzle', nb: 'Yr' },
  'weather.light_rain': { en: 'Light rain', nb: 'Lett regn' },
  'weather.rain': { en: 'Rain', nb: 'Regn' },
  'weather.heavy_rain': { en: 'Heavy rain', nb: 'Kraftig regn' },
  'weather.snow': { en: 'Snow', nb: 'Snø' },
  'weather.showers': { en: 'Showers', nb: 'Regnbyger' },
  'weather.snow_showers': { en: 'Snow showers', nb: 'Snøbyger' },
  'weather.thunderstorms': { en: 'Thunderstorms', nb: 'Tordenvær' },
  'weather.rain_from': { en: 'Rain from {hour}', nb: 'Regn fra {hour}' },
  'weather.dry_from': { en: 'Dry from {hour}', nb: 'Opphold fra {hour}' },
  'weather.dry_all_day': { en: 'Dry all day', nb: 'Opphold hele dagen' },
  'weather.rain_saturday': { en: 'Rain on Saturday', nb: 'Regn på lørdag' },
  'weather.rain_sunday': { en: 'Rain on Sunday', nb: 'Regn på søndag' },
  // The parcels on the notice board: one parcel, or how many.
  'parcel.out': {
    en: '{count, plural, one {Parcel out for delivery} other {# parcels out for delivery}}',
    nb: '{count, plural, one {Pakke ute for levering} other {# pakker ute for levering}}'
  },
  'parcel.held': {
    en: '{count, plural, one {Parcel needs attention} other {# parcels need attention}}',
    nb: '{count, plural, one {Pakke trenger oppfølging} other {# pakker trenger oppfølging}}'
  },
  'parcel.late': {
    en: '{count, plural, one {Parcel late} other {# parcels late}}',
    nb: '{count, plural, one {Pakke forsinket} other {# pakker forsinket}}'
  },
  'parcel.arriving': {
    en: '{count, plural, one {Parcel arriving {when}} other {# parcels arriving {when}}}',
    nb: '{count, plural, one {Pakke kommer {when}} other {# pakker kommer {when}}}'
  },
  'parcel.undated': {
    en: '{count, plural, one {Parcel on its way} other {# parcels on their way}}',
    nb: '{count, plural, one {Pakke på vei} other {# pakker på vei}}'
  },
  'parcel.delivered': {
    en: '{count, plural, one {Parcel delivered} other {# parcels delivered}}',
    nb: '{count, plural, one {Pakke levert} other {# pakker levert}}'
  }
} as const satisfies Record<string, Readonly<Record<Language, string>>>;

/** An id STRINGS has: any other is a compile error. */
export type StringId = keyof typeof STRINGS;
