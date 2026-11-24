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
  'settings.screen': { en: 'Screen', nb: 'Skjerm' },
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
  'common.back': { en: 'Back', nb: 'Tilbake' },
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
  'general.location': { en: 'Location', nb: 'Sted' },
  'general.no_place': { en: 'No place', nb: 'Ikke valgt' },
  'general.location_caption': {
    en: 'Drives the weather forecast and background.',
    nb: 'Styrer værmeldingen og bakgrunnen.'
  },
  'general.postcode': { en: 'Postcode', nb: 'Postnummer' },
  'general.postcode_caption': {
    en: 'Drives the local notices on the notice board.',
    nb: 'Styrer de lokale oppslagene på oppslagstavlen.'
  },
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
  'general.brightness': { en: 'Brightness', nb: 'Lysstyrke' },
  'general.quiet_hours': { en: 'Quiet hours', nb: 'Stille timer' },
  'general.from': { en: 'From', nb: 'Fra' },
  'general.to': { en: 'To', nb: 'Til' },
  'quiet.caption': {
    en: 'Between these times the screen sleeps a minute after the last touch.',
    nb: 'Mellom disse tidene sovner skjermen et minutt etter siste berøring.'
  },
  'quiet.now_quiet': { en: 'quiet now', nb: 'stille nå' },
  'quiet.now_awake': { en: 'awake now, at {time}', nb: 'våken nå, klokken {time}' },
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
  'weather.tomorrow': { en: 'Tomorrow', nb: 'I morgen' },
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
  },
  // Settings › Countdown.
  'countdown.add': { en: 'Add a station or stop', nb: 'Legg til en stasjon eller et stopp' },
  'countdown.saved': { en: 'Saved stops', nb: 'Lagrede stopp' },
  'countdown.none': { en: 'No stops yet.', nb: 'Ingen stopp ennå.' },
  'countdown.group_by_route': { en: 'Group by route', nb: 'Grupper etter linje' },
  'countdown.grouped_off': {
    en: 'A board with a row for each departure',
    nb: 'En tavle med én rad for hver avgang'
  },
  'countdown.grouped_on': {
    en: 'A board with a row for each route and its next departures',
    nb: 'En tavle med én rad for hver linje og dens neste avganger'
  },
  'countdown.transition': { en: 'Changing stops', nb: 'Bytte av stopp' },
  'countdown.transition.flip': { en: 'Flip', nb: 'Vend' },
  'countdown.transition.slide': { en: 'Slide', nb: 'Skyv' },
  'countdown.transition.sinkRise': { en: 'Sink and rise', nb: 'Synk og stig' },
  'countdown.transition.none': { en: 'None', nb: 'Ingen' },
  'countdown.move': { en: 'Move {name}', nb: 'Flytt {name}' },
  'countdown.remove': { en: 'Remove {name}', nb: 'Fjern {name}' },
  'countdown.add_stops': { en: 'Add stops', nb: 'Legg til stopp' },
  'countdown.search': { en: 'Search for a stop', nb: 'Søk etter et stopp' },
  'countdown.placeholder': { en: 'Station or stop', nb: 'Stasjon eller stopp' },
  'countdown.hint': {
    en: 'Type the name of a station or stop, then tap it to add it.',
    nb: 'Skriv navnet på en stasjon eller et stopp, og trykk på det for å legge det til.'
  },
  'common.close': { en: 'Close', nb: 'Lukk' },
  'common.next': { en: 'Next', nb: 'Neste' },
  'common.not_now': { en: 'Not now', nb: 'Ikke nå' },

  // Settings › Parcels.
  'parcels.notice_board': { en: 'Notice board', nb: 'Oppslagstavle' },
  'parcels.arriving_by': { en: 'Arriving by', nb: 'Kommer innen' },
  'parcels.today': { en: 'Today', nb: 'I dag' },
  'parcels.tomorrow': { en: 'Tomorrow', nb: 'I morgen' },
  'parcels.day_after': { en: 'Day after', nb: 'I overmorgen' },
  'parcels.any_day': { en: 'Any day', nb: 'Når som helst' },
  'parcels.delivered_stay': { en: 'Delivered ones stay', nb: 'Leverte vises i' },
  'parcels.not_kept': { en: 'Not kept', nb: 'Ikke vist' },
  'parcels.hours': {
    en: '{hours, plural, one {# hour} other {# hours}}',
    nb: '{hours, plural, one {# time} other {# timer}}'
  },
  'parcels.a_day': { en: 'A day', nb: 'Ett døgn' },
  'parcels.set_up': { en: 'Set up Parcel', nb: 'Sett opp Parcel' },
  'parcels.step_premium': { en: 'Get Parcel Premium in the Parcel app', nb: 'Skaff Parcel Premium i Parcel-appen' },
  'parcels.step_key': {
    en: 'Copy your API key from web.parcelapp.net',
    nb: 'Kopier API-nøkkelen din fra web.parcelapp.net'
  },
  'parcels.step_scan': { en: 'Scan the code and paste the key', nb: 'Skann koden og lim inn nøkkelen' },

  // Settings › Appearance.
  'appearance.colour': { en: 'Colour', nb: 'Farge' },
  'appearance.sample_title': { en: 'Song title', nb: 'Sangtittel' },
  'appearance.sample_artist': { en: 'Artist', nb: 'Artist' },
  'appearance.sample_always': { en: 'Your colour', nb: 'Din farge' },
  'appearance.sample_idle': { en: 'Your colour, when nothing plays', nb: 'Din farge, når ingenting spilles' },
  'appearance.sample_playing': { en: 'While music plays', nb: 'Mens musikken spilles' },
  'appearance.dynamic': { en: 'Dynamic', nb: 'Dynamisk' },
  'appearance.dynamic_note': {
    en: 'Colours follow the album art while music plays.',
    nb: 'Fargene følger albumomslaget mens musikken spilles.'
  },
  'colour.forest': { en: 'Forest', nb: 'Skog' },
  'colour.navy': { en: 'Navy', nb: 'Marineblå' },
  'colour.teal': { en: 'Teal', nb: 'Blågrønn' },
  'colour.plum': { en: 'Plum', nb: 'Plomme' },
  'colour.terracotta': { en: 'Terracotta', nb: 'Terrakotta' },
  'colour.pink': { en: 'Pink', nb: 'Rosa' },
  'colour.yellow': { en: 'Yellow', nb: 'Gul' },
  'colour.black': { en: 'Black', nb: 'Svart' },
  'colour.violet': { en: 'Violet', nb: 'Fiolett' },

  // Settings › Wi-Fi.
  'wifi.current': { en: 'Current network', nb: 'Nåværende nettverk' },
  'wifi.connected': { en: 'Connected', nb: 'Tilkoblet' },
  'wifi.connected_address': { en: 'Connected · {address}', nb: 'Tilkoblet · {address}' },
  'wifi.change': { en: 'Change network', nb: 'Bytt nettverk' },
  'wifi.choose': { en: 'Choose network', nb: 'Velg nettverk' },
  'wifi.not_connected': { en: 'Not connected', nb: 'Ikke tilkoblet' },
  'wifi.unknown': { en: 'Status unknown', nb: 'Ukjent status' },
  'wifi.others': { en: 'Other networks', nb: 'Andre nettverk' },
  'wifi.forget': { en: 'Forget', nb: 'Glem' },
  'wifi.forget_confirm': { en: 'Tap again to forget', nb: 'Trykk igjen for å glemme' },
  'wifi.other': { en: 'Other network', nb: 'Annet nettverk' },
  'wifi.refresh': { en: 'Refresh', nb: 'Oppdater' },
  'wifi.searching': { en: 'Looking for networks…', nb: 'Søker etter nettverk …' },
  'wifi.no_networks': { en: 'No networks found.', nb: 'Ingen nettverk funnet.' },
  'wifi.not_supported': { en: 'Not supported', nb: 'Støttes ikke' },
  'wifi.secured': { en: 'Needs a password', nb: 'Krever passord' },
  'wifi.signal': { en: 'Signal {bars} of 4', nb: 'Signal {bars} av 4' },
  'wifi.join': { en: 'Join {ssid}', nb: 'Koble til {ssid}' },
  'wifi.name': { en: 'Network name', nb: 'Nettverksnavn' },
  'wifi.password': { en: 'Password', nb: 'Passord' },
  'wifi.show': { en: 'Show', nb: 'Vis' },
  'wifi.hide': { en: 'Hide', nb: 'Skjul' },
  'wifi.connect': { en: 'Connect', nb: 'Koble til' },
  'wifi.connecting': { en: 'Connecting to {ssid}…', nb: 'Kobler til {ssid} …' },
  'wifi.hotspot': { en: 'Hotspot', nb: 'Hotspot' },
  'wifi.back': { en: 'Back', nb: 'Tilbake' },
  'wifi.starting': { en: 'Starting…', nb: 'Starter …' },
  'wifi.waiting_for_phone': { en: 'Waiting for your phone…', nb: 'Venter på telefonen …' },
  'wifi.phone_joining': {
    en: 'The phone chose a network. Joining it…',
    nb: 'Telefonen valgte et nettverk. Kobler til …'
  },
  'wifi.qr_join': { en: 'QR code that joins the hotspot', nb: 'QR-kode som kobler til hotspoten' },
  'wifi.qr_open': { en: 'QR code that opens the setup page', nb: 'QR-kode som åpner oppsettsiden' },
  'wifi.step_join': { en: 'Join the hotspot', nb: 'Koble til hotspoten' },
  'wifi.step_open': { en: 'Open the setup page', nb: 'Åpne oppsettsiden' },
  'wifi.step_joined': { en: 'Phone connected', nb: 'Telefonen er koblet til' },
  'wifi.unreachable': {
    en: 'Could not reach the kiosk service.',
    nb: 'Får ikke kontakt med tjenesten på nettbrettet.'
  },

  // Settings › Spotify.
  'spotify.connected': { en: 'Connected', nb: 'Tilkoblet' },
  'spotify.expired': { en: 'Expired', nb: 'Utløpt' },
  'spotify.refused': { en: 'Not allowed', nb: 'Ikke tillatt' },
  'spotify.people': { en: 'People', nb: 'Personer' },
  'spotify.account': { en: 'Spotify account', nb: 'Spotify-konto' },
  'spotify.active': { en: 'Active', nb: 'Aktiv' },
  'spotify.sign_in': { en: 'Sign in', nb: 'Logg inn' },
  'spotify.remove': { en: 'Remove', nb: 'Fjern' },
  'spotify.remove_confirm': { en: 'Tap again to remove', nb: 'Trykk igjen for å fjerne' },
  'spotify.add_person': { en: 'Add person', nb: 'Legg til person' },
  'spotify.add': { en: 'Add', nb: 'Legg til' },
  'spotify.log_in': { en: 'Log in with Spotify', nb: 'Logg inn med Spotify' },
  'spotify.sign_in_title': { en: 'Sign in to Spotify', nb: 'Logg inn på Spotify' },
  'spotify.sign_in_unavailable': {
    en: 'Add this screen to Countdown to sign in.',
    nb: 'Legg til denne skjermen i Countdown for å logge inn.'
  },
  'soloist.add_key': { en: 'Add Soloist key', nb: 'Legg til Soloist-nøkkel' },
  'soloist.key_of': { en: '{name}’s Soloist key', nb: 'Soloist-nøkkelen til {name}' },

  // Settings › Lyrics.
  'lyrics.sample_1': { en: 'Under the kitchen light', nb: 'Under lyset på kjøkkenet' },
  'lyrics.sample_2': { en: 'we sang the whole way home', nb: 'sang vi hele veien hjem' },
  'lyrics.sample_3': { en: 'and the night kept time for us', nb: 'og natten holdt takten for oss' },
  'lyrics.size': { en: 'Size', nb: 'Størrelse' },
  'lyrics.alignment': { en: 'Alignment', nb: 'Justering' },
  'lyrics.size.small': { en: 'Small', nb: 'Liten' },
  'lyrics.size.medium': { en: 'Medium', nb: 'Middels' },
  'lyrics.size.large': { en: 'Large', nb: 'Stor' },
  'lyrics.size.x-large': { en: 'Extra large', nb: 'Ekstra stor' },
  'lyrics.align.left': { en: 'Left', nb: 'Venstre' },
  'lyrics.align.center': { en: 'Centre', nb: 'Midtstilt' },
  'lyrics.align.right': { en: 'Right', nb: 'Høyre' },

  // Settings › About.
  'about.this_screen': { en: 'This screen', nb: 'Denne skjermen' },
  'about.device_id': { en: 'Device ID', nb: 'Enhets-ID' },
  'about.not_registered': { en: 'Not registered', nb: 'Ikke registrert' },
  'about.size': { en: 'Size', nb: 'Størrelse' },
  'about.ip_address': { en: 'IP address', nb: 'IP-adresse' },
  'about.unknown': { en: 'Unknown', nb: 'Ukjent' },
  'about.app_version': { en: 'App version', nb: 'Appversjon' },
  'about.software': { en: 'Software', nb: 'Programvare' },
  'about.debug': { en: 'Debug console', nb: 'Feilsøkingskonsoll' },
  'about.pi_software': { en: 'Pi software', nb: 'Pi-programvare' },
  'about.no_version': {
    en: 'The Pi did not say which version it runs.',
    nb: 'Pi-en sa ikke hvilken versjon den kjører.'
  },
  'about.checking': {
    en: 'Checking GitHub for a newer {what}…',
    nb: '{what, select, release {Ser etter en nyere utgivelse på GitHub …} other {Ser etter en nyere {what} på GitHub …}}'
  },
  'about.check_failed': {
    en: 'Could not check GitHub for a newer {what}.',
    nb: '{what, select, release {Kunne ikke se etter en nyere utgivelse på GitHub.} other {Kunne ikke se etter en nyere {what} på GitHub.}}'
  },
  'about.newer': {
    en: '{newer}. Tap the button to install it now, or the Pi picks it up within 6 hours and applies it at 04:30.',
    nb: '{newer}. Trykk på knappen for å installere nå, ellers henter Pi-en den innen 6 timer og tar den i bruk kl. 04:30.'
  },
  'about.up_to_date': { en: 'Up to date.', nb: 'Oppdatert.' },
  'about.install': { en: 'Install', nb: 'Installer' },
  'about.installed': {
    en: '{version} is installed. Restart to finish.',
    nb: '{version} er installert. Start på nytt for å fullføre.'
  },
  'about.failed': {
    en: '{version} did not start on this Pi, so it is not installed.',
    nb: '{version} startet ikke på denne Pi-en, så den blir ikke installert.'
  },
  'about.restart_now': { en: 'Restart now', nb: 'Start på nytt nå' },
  'about.up_to_date_at': { en: 'Up to date as of {time}.', nb: 'Oppdatert per {time}.' },
  'about.check': { en: 'Check for updates', nb: 'Se etter oppdateringer' },
  'about.restart': { en: 'Restart kiosk', nb: 'Start kiosken på nytt' },
  'about.restart_confirm': { en: 'Tap again to restart', nb: 'Trykk igjen for å starte på nytt' },
  'about.reboot': { en: 'Reboot Pi', nb: 'Start Pi-en på nytt' },
  'about.reboot_confirm': { en: 'Tap again to reboot', nb: 'Trykk igjen for å starte på nytt' },

  // More words several screens use.
  'common.try_again': { en: 'Try again', nb: 'Prøv igjen' },
  'common.details': { en: 'Details', nb: 'Detaljer' },
  'common.saving': { en: 'Saving…', nb: 'Lagrer …' },
  'common.loading': { en: 'Loading...', nb: 'Laster …' },

  // The Spotify tab and its panels.
  'spotify_tab.upcoming': { en: 'Upcoming tracks', nb: 'Kommende spor' },
  'spotify_tab.sonos_first': {
    en: 'Play a song first, then pick the Sonos speaker.',
    nb: 'Spill av en sang først, og velg så Sonos-høyttaleren.'
  },
  'spotify_tab.quota': { en: 'Spotify quota exceeded.', nb: 'Spotify-kvoten er brukt opp.' },
  'spotify_tab.wait': {
    en: 'Spotify asked this app to wait before retrying.',
    nb: 'Spotify ba appen vente før den prøver igjen.'
  },
  'panel.nav': { en: 'Beside the artwork', nb: 'Ved siden av omslaget' },
  'panel.queue': { en: 'Queue', nb: 'Kø' },
  'panel.lyrics': { en: 'Lyrics', nb: 'Sangtekster' },
  'panel.speakers': { en: 'Speakers', nb: 'Høyttalere' },

  // The player.
  'player.nothing_playing': { en: 'Nothing playing', nb: 'Ingenting spilles' },
  'player.playing_on': { en: 'Playing on {device}', nb: 'Spiller på {device}' },
  'player.select_device': { en: 'Select a device', nb: 'Velg en enhet' },
  'player.speakers': { en: 'Speakers: {state}', nb: 'Høyttalere: {state}' },
  'player.artwork': { en: '{title} album artwork', nb: 'Albumomslag for {title}' },
  'player.track_info': { en: 'Track information', nb: 'Om sporet' },
  'player.position': { en: 'Playback position', nb: 'Avspillingsposisjon' },
  'player.position_of': { en: '{elapsed} of {total}', nb: '{elapsed} av {total}' },
  'player.time_unknown': { en: 'Playback time unavailable', nb: 'Spilletiden er ukjent' },
  'player.shuffle': { en: 'Shuffle', nb: 'Tilfeldig rekkefølge' },
  'player.back_15': { en: 'Back 15 seconds', nb: '15 sekunder tilbake' },
  'player.previous_track': { en: 'Previous track', nb: 'Forrige spor' },
  'player.next_track': { en: 'Next track', nb: 'Neste spor' },
  'player.forward_15': { en: 'Forward 15 seconds', nb: '15 sekunder frem' },
  'player.repeat_off': { en: 'Repeat off', nb: 'Gjenta av' },
  'player.repeat_all': { en: 'Repeat all', nb: 'Gjenta alle' },
  'player.repeat_one': { en: 'Repeat one', nb: 'Gjenta én' },
  'player.volume': { en: 'Volume', nb: 'Volum' },
  'image.unavailable': { en: '{alt} unavailable', nb: '{alt} er ikke tilgjengelig' },

  // The queue.
  'queue.waiting_retry': { en: 'Waiting to retry...', nb: 'Venter før nytt forsøk …' },
  'queue.retrying': { en: 'Retrying...', nb: 'Prøver igjen …' },
  'queue.retry': { en: 'Retry queue', nb: 'Last inn køen på nytt' },
  'queue.loading': { en: 'Loading queue...', nb: 'Laster køen …' },
  'queue.waiting': { en: 'Waiting for Spotify...', nb: 'Venter på Spotify …' },
  'queue.connect_hint': { en: 'Connect Spotify to see the queue.', nb: 'Koble til Spotify for å se køen.' },
  'queue.unavailable': { en: 'Queue unavailable.', nb: 'Køen er utilgjengelig.' },
  'queue.not_loaded': { en: 'The queue could not be loaded.', nb: 'Kunne ikke laste inn køen.' },
  'queue.search': { en: 'Search for music', nb: 'Søk etter musikk' },
  'queue.waiting_update': {
    en: 'Waiting for Spotify before updating the queue.',
    nb: 'Venter på Spotify før køen oppdateres.'
  },
  'queue.last_known': { en: 'Showing the last known queue.', nb: 'Viser den sist kjente køen.' },
  'queue.up_next': { en: 'Up next:', nb: 'Neste i køen:' },
  'queue.list': { en: 'Track queue', nb: 'Køen' },
  'queue.unknown_artist': { en: 'Unknown artist', nb: 'Ukjent artist' },
  'queue.play': { en: 'Play {title} by {artist}', nb: 'Spill av {title} av {artist}' },
  'queue.next': { en: 'NEXT', nb: 'NESTE' },

  // The lyrics.
  'lyrics.idle_title': { en: 'Nothing to sing along to yet.', nb: 'Ingenting å synge med på ennå.' },
  'lyrics.idle_text': { en: 'Play a song and its lyrics show up here.', nb: 'Spill av en sang, så vises teksten her.' },
  'lyrics.looking': { en: 'Looking for the lyrics...', nb: 'Ser etter sangteksten …' },
  'lyrics.none_title': { en: 'No lyrics for this one.', nb: 'Ingen sangtekst til denne.' },
  'lyrics.none_text': {
    en: 'The lyrics database does not have this song yet.',
    nb: 'Tekstdatabasen har ikke denne sangen ennå.'
  },
  'lyrics.instrumental_title': { en: 'Instrumental.', nb: 'Instrumental.' },
  'lyrics.instrumental_text': { en: 'No words, just the music.', nb: 'Ingen ord, bare musikk.' },
  'lyrics.of': { en: 'Lyrics of {title}', nb: 'Sangteksten til {title}' },
  'lyrics.of_this_song': { en: 'Lyrics of this song', nb: 'Sangteksten til denne sangen' },
  'lyrics.region': { en: 'Lyrics', nb: 'Sangtekster' },

  // The speakers.
  'speakers.kind': { en: 'Kind of speaker', nb: 'Type høyttaler' },
  'speakers.this_tablet': { en: 'This tablet', nb: 'Dette nettbrettet' },
  'speakers.count': {
    en: '{count, plural, one {# speaker} other {# speakers}}',
    nb: '{count, plural, one {# høyttaler} other {# høyttalere}}'
  },
  'speakers.playing': { en: 'Playing', nb: 'Spiller' },
  'speakers.connecting': { en: 'Connecting…', nb: 'Kobler til …' },
  'speakers.connect': { en: 'Connect', nb: 'Koble til' },
  'speakers.connect_name': { en: 'Connect {name}', nb: 'Koble til {name}' },
  'speakers.pair': { en: 'Pair', nb: 'Koble sammen' },
  'speakers.pair_name': { en: 'Pair {name}', nb: 'Koble sammen {name}' },
  'speakers.forget': { en: 'Forget', nb: 'Glem' },
  'speakers.forget_name': { en: 'Forget {name}', nb: 'Glem {name}' },
  'speakers.volume_of': { en: '{name} volume', nb: 'Volum for {name}' },
  'speakers.volumes': { en: 'Volumes', nb: 'Volum' },
  'speakers.looking': { en: 'Looking for speakers…', nb: 'Ser etter høyttalere …' },
  'speakers.find': { en: 'Find speakers', nb: 'Finn høyttalere' },
  'speakers.refresh': { en: 'Refresh speakers', nb: 'Oppdater høyttalerne' },

  // The music picker.
  'music.close': { en: 'Close music', nb: 'Lukk musikkvelgeren' },
  'music.tabs': { en: 'Music to choose from', nb: 'Musikk å velge blant' },
  'music.playlists': { en: 'Playlists', nb: 'Spillelister' },
  'music.recent': { en: 'Recently played', nb: 'Nylig spilt' },
  'music.search': { en: 'Search', nb: 'Søk' },
  'music.liked': { en: 'Liked Songs', nb: 'Likte sanger' },
  'music.search_spotify': { en: 'Search Spotify', nb: 'Søk i Spotify' },
  'music.placeholder': { en: 'Songs, albums or playlists', nb: 'Sanger, album eller spillelister' },
  'music.type_to_search': { en: 'Type to search Spotify.', nb: 'Skriv for å søke i Spotify.' },
  'music.searching': { en: 'Searching...', nb: 'Søker …' },
  'music.results': { en: 'Search results', nb: 'Søkeresultater' },
  'music.empty': { en: 'Nothing here yet.', nb: 'Ingenting her ennå.' },

  // Playback problems: a few words in the player and in the warning list, with the one button that fixes it.
  'problems.title': { en: 'Problems', nb: 'Problemer' },
  'problems.dashboard': { en: 'Dashboard not updating', nb: 'Dashbordet oppdateres ikke' },
  'problems.departures': { en: 'Departures not updating', nb: 'Avgangene oppdateres ikke' },
  'notice.restricted_title': { en: "Can't control this speaker", nb: 'Kan ikke styre denne høyttaleren' },
  'notice.choose_speaker': { en: 'Choose speaker', nb: 'Velg høyttaler' },
  'notice.quota_title': { en: 'Spotify quota used up', nb: 'Spotify-kvoten er brukt opp' },
  'notice.wait_title': { en: 'Waiting for Spotify', nb: 'Venter på Spotify' },
  'notice.problem_title': { en: 'Playback problem', nb: 'Problem med avspillingen' },
  'notice.no_speaker': { en: 'No speaker available', nb: 'Ingen høyttaler tilgjengelig' },
  'notice.sign_in_title': { en: 'Spotify sign-in needed', nb: 'Spotify-innlogging trengs' },
  'notice.reconnect_spotify': { en: 'Reconnect Spotify', nb: 'Koble til Spotify igjen' },
  'notice.settings_title': { en: 'Check Spotify settings', nb: 'Sjekk Spotify-innstillingene' },
  'notice.soloist_key_title': { en: 'Soloist key needed', nb: 'Soloist-nøkkel trengs' },
  'notice.pick_on_phone_title': {
    en: 'Pick {device} in Spotify on your phone',
    nb: 'Velg {device} i Spotify på telefonen'
  },
  'notice.pick_kiosk_on_phone_title': {
    en: 'Pick this kiosk in Spotify on your phone',
    nb: 'Velg denne kiosken i Spotify på telefonen'
  },
  'notice.player_title': { en: 'Tablet player disconnected', nb: 'Nettbrettspilleren er frakoblet' },
  'notice.reconnect_player': { en: 'Reconnect player', nb: 'Koble til spilleren igjen' },
  'notice.refresh': { en: 'Refresh playback', nb: 'Oppdater avspillingen' },
  'notice.checking': { en: 'Checking...', nb: 'Sjekker …' },

  // Signing in to Spotify, and no internet.
  'setup.title': { en: 'Bring your music to the tablet', nb: 'Ta med musikken din til nettbrettet' },
  'setup.offline': { en: 'Reconnect to the network to sign in.', nb: 'Koble til nettverket igjen for å logge inn.' },
  'setup.connect': { en: 'Connect Spotify', nb: 'Koble til Spotify' },
  'offline.title': { en: 'No internet connection', nb: 'Ingen internettilkobling' },
  'offline.wifi': { en: 'Wi-Fi settings', nb: 'Wi-Fi-innstillinger' },

  // Switching person, and pairing a phone.
  'person.switch': { en: 'Switch person', nb: 'Bytt person' },
  'person.switch_name': { en: '{name}: switch person', nb: '{name}: bytt person' },
  'phone.none': { en: 'No phone', nb: 'Ingen telefon' },
  'phone.of': { en: '{name}’s phone', nb: 'Telefonen til {name}' },
  'phone.pair_new': { en: 'Pair new phone', nb: 'Koble sammen ny telefon' },
  'pair.title': { en: 'Pair your phone', nb: 'Koble sammen telefonen din' },
  'pair.title_of': { en: 'Pair {name}’s phone', nb: 'Koble sammen telefonen til {name}' },
  'pair.key': { en: 'Your phone is your key!', nb: 'Telefonen din er nøkkelen din!' },
  'pair.intro': {
    en: 'Once it’s paired, the tablet knows the moment you walk in, and only you can switch to your account.',
    nb: 'Når den er paret, vet nettbrettet med en gang når du kommer inn, og bare du kan bytte til kontoen din.'
  },
  'pair.go': { en: 'Let’s do it!', nb: 'Sett i gang!' },
  'pair.searching': { en: 'Searching', nb: 'Søker' },
  'pair.pairing': { en: 'Pairing', nb: 'Kobler sammen' },
  'pair.accept': { en: 'Accept the pairing request on your phone.', nb: 'Godta paringsforespørselen på telefonen.' },
  'pair.step_settings': { en: 'Open Settings', nb: 'Åpne Innstillinger' },
  'pair.step_bluetooth': { en: 'Open Bluetooth', nb: 'Åpne Bluetooth' },
  'pair.step_tap': { en: 'Tap your phone in the list below', nb: 'Trykk på telefonen din i listen nedenfor' },
  'pair.nearby': { en: 'Nearby', nb: 'I nærheten' },
  'pair.skip': { en: 'Skip', nb: 'Hopp over' },
  'pair.all_set': { en: 'You’re all set!', nb: 'Alt er klart!' },
  'pair.switch_hint': {
    en: 'Tap your photo any time to switch between accounts!',
    nb: 'Trykk på bildet ditt når som helst for å bytte konto!'
  },
  'pair.awesome': { en: 'Awesome!', nb: 'Supert!' },

  // Updating the Pi, the sleep screen and adding the screen to countdown-server.
  'update.available': { en: 'Update available', nb: 'Oppdatering tilgjengelig' },
  'update.prompt': {
    en: 'Updating takes a few minutes, and the tablet restarts by itself if anything changed. If you wait, the Pi picks it up on its own and applies it at 04:30.',
    nb: 'Oppdateringen tar noen minutter, og nettbrettet starter på nytt av seg selv hvis noe er endret. Hvis du venter, henter Pi-en den selv og tar den i bruk kl. 04:30.'
  },
  'update.now': { en: 'Update now', nb: 'Oppdater nå' },
  'update.later': { en: 'Not now', nb: 'Ikke nå' },
  'update.title': { en: 'Updating the Pi', nb: 'Oppdaterer Pi-en' },
  'update.close': { en: 'Close update console', nb: 'Lukk oppdateringskonsollen' },
  'update.updating': { en: 'Updating… this can take a few minutes.', nb: 'Oppdaterer … dette kan ta noen minutter.' },
  'update.task': { en: 'Task {done} of {total}', nb: 'Oppgave {done} av {total}' },
  'update.percent': { en: '{percent}% installed', nb: '{percent} % installert' },
  'update.output': { en: 'Update output', nb: 'Utdata fra oppdateringen' },
  'update.starting': { en: 'Starting the update…', nb: 'Starter oppdateringen …' },
  'update.leave_on': {
    en: 'The tablet restarts by itself when the update needs it. Please leave it on.',
    nb: 'Nettbrettet starter på nytt av seg selv når oppdateringen krever det. La det stå på.'
  },
  'sleep.dimmed': { en: 'Dimmed screen', nb: 'Dempet skjerm' },
  'sleep.asleep': { en: 'Sleep screen', nb: 'Hvileskjerm' },
  'sleep.wake': { en: 'Wake the screen', nb: 'Vekk skjermen' },
  'pairing.title': { en: 'Add this screen', nb: 'Legg til denne skjermen' },
  'pairing.code': {
    en: 'QR code to add this screen to your account',
    nb: 'QR-kode for å legge denne skjermen til kontoen din'
  },
  'pairing.scan': { en: 'Scan to get started', nb: 'Skann for å komme i gang' },
  'pairing.wifi_intro': {
    en: 'To get started, your Max Mix needs internet access. Pick a network below, or choose another way to join one.',
    nb: 'For å komme i gang trenger Max Mix tilgang til internett. Velg et nettverk nedenfor, eller en annen måte å koble til på.'
  },
  'pairing.connected': { en: 'Connected to {ssid}', nb: 'Koblet til {ssid}' }
} as const satisfies Record<string, Readonly<Record<Language, string>>>;

/** An id STRINGS has: any other is a compile error. */
export type StringId = keyof typeof STRINGS;
