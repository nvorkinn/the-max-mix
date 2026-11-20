// The words of the kiosk's own pages, in English and Norwegian Bokmål: the Wi-Fi setup page (wifi-setup.ts and
// wifi-page.ts), which follows the tablet's language, and the hotspot's page for a phone (hotspot-portal.ts), which
// follows the phone's. The app has its own catalogue (src/i18n); this service ships to the Pi on its own, so it keeps
// this small one. It runs in the browser too (wifi-setup.ts serves it next to the page script), so it imports nothing.
// `{name}` in a text is filled in from `say`'s arguments.

/** English (en) or Norwegian Bokmål (nb), as the app's config names them. */
export type Language = 'en' | 'nb';

/** Each language's tag for `<html lang>`. */
export const LOCALES: Readonly<Record<Language, string>> = { en: 'en-GB', nb: 'nb-NO' };

const WORDS = {
  // The Wi-Fi setup page on the kiosk's screen.
  'wifi.title': { en: 'Wi-Fi setup', nb: 'Wi-Fi-oppsett' },
  'wifi.choose': { en: 'Choose a Wi-Fi network', nb: 'Velg nettverk' },
  'wifi.other': { en: 'Other…', nb: 'Annet …' },
  'wifi.fromPhone': { en: 'From phone', nb: 'Fra telefon' },
  'wifi.hotspot': { en: 'Hotspot', nb: 'Hotspot' },
  'wifi.refresh': { en: 'Refresh', nb: 'Oppdater' },
  'wifi.cancel': { en: 'Cancel', nb: 'Avbryt' },
  'wifi.back': { en: 'Back', nb: 'Tilbake' },
  'wifi.anyPhone': { en: 'Set up from any phone', nb: 'Sett opp fra en telefon' },
  'wifi.qrJoin': { en: 'QR code that joins the hotspot', nb: 'QR-kode som kobler til hotspoten' },
  'wifi.scanToJoin': { en: '1. Scan to join', nb: '1. Skann for å koble til' },
  'wifi.passwordIs': { en: 'Password:', nb: 'Passord:' },
  'wifi.qrOpen': { en: 'QR code that opens the setup page', nb: 'QR-kode som åpner oppsettsiden' },
  'wifi.scanToOpen': {
    en: '2. If the page does not open by itself, scan to open',
    nb: '2. Åpnes ikke siden? Skann for å åpne'
  },
  'wifi.join': { en: 'Join', nb: 'Koble til' },
  'wifi.joinNetwork': { en: 'Join {ssid}', nb: 'Koble til {ssid}' },
  'wifi.otherNetwork': { en: 'Other network', nb: 'Annet nettverk' },
  'wifi.networkName': { en: 'Network name', nb: 'Nettverksnavn' },
  'wifi.password': { en: 'Password', nb: 'Passord' },
  'wifi.show': { en: 'Show', nb: 'Vis' },
  'wifi.hide': { en: 'Hide', nb: 'Skjul' },
  'wifi.connect': { en: 'Connect', nb: 'Koble til' },
  'wifi.connecting': { en: 'Connecting to {ssid}…', nb: 'Kobler til {ssid} …' },
  'wifi.connected': { en: 'Connected to {ssid}', nb: 'Tilkoblet {ssid}' },
  'wifi.unreachable': {
    en: 'Could not reach the kiosk service.',
    nb: 'Får ikke kontakt med tjenesten på nettbrettet.'
  },
  'wifi.notSupported': { en: 'Not supported', nb: 'Støttes ikke' },
  'wifi.signal': { en: 'Signal {bars} of 4', nb: 'Signal {bars} av 4' },
  'wifi.searching': { en: 'Looking for networks…', nb: 'Søker etter nettverk …' },
  'wifi.noNetworks': {
    en: 'No networks found. Tap Refresh to scan again.',
    nb: 'Ingen nettverk funnet. Trykk på Oppdater for å søke igjen.'
  },
  'wifi.phoneHelp': {
    en: 'On an Android phone with Chrome, open improv-wifi.com, tap Connect device and choose THE MAX MIX. Waiting for your phone…',
    nb: 'Åpne improv-wifi.com i Chrome på en Android-telefon, trykk på Connect device og velg THE MAX MIX. Venter på telefonen …'
  },
  'wifi.phoneFailed': { en: 'Could not start phone setup.', nb: 'Kunne ikke starte oppsett fra telefon.' },
  'wifi.phoneJoining': {
    en: 'The phone chose a network. The kiosk is joining it…',
    nb: 'Telefonen valgte et nettverk. Nettbrettet kobler til …'
  },
  'wifi.joinFailed': { en: 'Could not join that network.', nb: 'Kunne ikke koble til det nettverket.' },
  'wifi.hotspotEnded': {
    en: 'The hotspot ended. Tap Hotspot to start it again.',
    nb: 'Hotspoten ble avsluttet. Trykk på Hotspot for å starte den igjen.'
  },
  'wifi.waitingForPhone': { en: 'Waiting for your phone…', nb: 'Venter på telefonen …' },
  'wifi.hotspotFailed': { en: 'Could not start the hotspot.', nb: 'Kunne ikke starte hotspoten.' },

  // The hotspot's page on a phone.
  'portal.choose': { en: 'Choose your Wi-Fi', nb: 'Velg Wi-Fi-nettverk' },
  'portal.intro': {
    en: 'The kiosk will join the network you pick.',
    nb: 'Nettbrettet kobler seg til nettverket du velger.'
  },
  'portal.otherNetwork': { en: 'Other network…', nb: 'Annet nettverk …' },
  'portal.joining': { en: 'The kiosk is joining it', nb: 'Nettbrettet kobler til' },
  'portal.leave': {
    en: 'This phone will leave the hotspot now. Join your usual Wi-Fi again, and watch the tablet: it says when it worked.',
    nb: 'Telefonen kobles fra hotspoten nå. Koble til det vanlige Wi-Fi-nettverket igjen, og følg med på nettbrettet: der ser du om det gikk.'
  },
  'portal.loadFailed': {
    en: 'Could not load the networks. Reload this page.',
    nb: 'Kunne ikke hente nettverkene. Last inn siden på nytt.'
  },
  'portal.refused': {
    en: 'The kiosk did not accept that. Check the name and password.',
    nb: 'Nettbrettet godtok ikke det. Sjekk navnet og passordet.'
  },

  // The service's own messages, which reach the setup page in English (nmcli.ts, hotspot.ts, server.ts): the page
  // shows them in its language with `localize`.
  'error.wrongPassword': {
    en: 'Wrong password. Check it and try again.',
    nb: 'Feil passord. Sjekk det og prøv igjen.'
  },
  'error.notFound': {
    en: 'Network not found. Move closer to the router and refresh.',
    nb: 'Fant ikke nettverket. Gå nærmere ruteren og oppdater.'
  },
  'error.timeout': {
    en: 'Timed out. The password may be wrong or the signal too weak.',
    nb: 'Tidsavbrudd. Passordet kan være feil, eller signalet for svakt.'
  },
  'error.disabled': { en: 'Wi-Fi is turned off.', nb: 'Wi-Fi er slått av.' },
  'error.denied': {
    en: 'Not allowed to change the network settings.',
    nb: 'Har ikke lov til å endre nettverksinnstillingene.'
  },
  'error.passwordLength': {
    en: 'The password must be 8 to 63 characters, or 64 hexadecimal digits.',
    nb: 'Passordet må ha 8 til 63 tegn, eller 64 heksadesimale sifre.'
  },
  'error.noNmcli': { en: 'NetworkManager is not available.', nb: 'NetworkManager er ikke tilgjengelig.' },
  'error.generic': { en: 'Could not connect.', nb: 'Kunne ikke koble til.' },
  'error.busy': {
    en: 'Already connecting. Wait for it to finish.',
    nb: 'Kobler allerede til. Vent til det er ferdig.'
  },
  'error.scan': { en: 'Could not scan for networks.', nb: 'Kunne ikke søke etter nettverk.' },
  'error.noBluetooth': {
    en: 'Bluetooth is not available, so the phone cannot be used.',
    nb: 'Bluetooth er ikke tilgjengelig, så telefonen kan ikke brukes.'
  },
  'error.hotspotNotStarted': { en: 'The hotspot could not be started.', nb: 'Hotspoten kunne ikke startes.' },
  'error.noAdapter': {
    en: 'There is no Wi-Fi adapter to make a hotspot with.',
    nb: 'Det finnes ingen Wi-Fi-adapter å lage en hotspot med.'
  },
  'error.pageNotStarted': { en: 'The setup page could not be started.', nb: 'Oppsettsiden kunne ikke startes.' },
  'error.hotspotJoining': {
    en: 'The kiosk is joining a network. Wait a moment.',
    nb: 'Nettbrettet kobler til et nettverk. Vent litt.'
  },
  'error.couldNotJoin': { en: 'Could not join {ssid}: {error}', nb: 'Kunne ikke koble til {ssid}: {error}' }
} as const satisfies Record<string, Readonly<Record<Language, string>>>;

export type WordId = keyof typeof WORDS;

/** The text for `id` in `language`, with each `{name}` filled in from `args` (left as it is when `args` has none). */
export function say(id: WordId, language: Language, args: Readonly<Record<string, string | number>> = {}): string {
  return WORDS[id][language].replaceAll(/\{(\w+)\}/g, (whole, name: string) => String(args[name] ?? whole));
}

/** A language from a request or a config: 'nb' is Norwegian; anything else, or nothing, is English. */
export function parseLanguage(value: unknown): Language {
  return value === 'nb' ? 'nb' : 'en';
}

/** The language of a page from its `<html lang>`: Norwegian for nb-NO (or nb), English for anything else. */
export function languageOfTag(tag: string): Language {
  return /^nb\b/i.test(tag) ? 'nb' : 'en';
}

const NORWEGIAN = new Set(['nb', 'no', 'nn']);

/**
 * The language a phone asks for in its Accept-Language header: Norwegian when, of the languages this page has, it
 * prefers a Norwegian one (nb, no or nn); English otherwise, and when it names neither.
 */
export function preferredLanguage(header = ''): Language {
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...parameters] = part.trim().split(';');
      const quality = parameters.map(parameter => /^\s*q=([\d.]+)\s*$/.exec(parameter)?.[1]).find(Boolean);
      return { primary: tag.trim().toLowerCase().split('-', 1)[0] ?? '', quality: Number(quality ?? 1), index };
    })
    .filter(({ quality }) => quality > 0)
    .toSorted((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { primary } of ranked) {
    if (NORWEGIAN.has(primary)) return 'nb';
    if (primary === 'en') return 'en';
  }
  return 'en';
}

const SERVICE_MESSAGES = (Object.keys(WORDS) as WordId[]).filter(id => id.startsWith('error.'));
const COULD_NOT_JOIN = /^Could not join (.*): (.+)$/su;

/**
 * One of the service's English messages (nmcli.ts, hotspot.ts, server.ts) in `language`. A message this catalogue does
 * not know stays as it is.
 */
export function localize(message: string, language: Language): string {
  if (language === 'en') return message;
  const known = SERVICE_MESSAGES.find(id => WORDS[id].en === message);
  if (known) return say(known, language);
  const failed = COULD_NOT_JOIN.exec(message);
  return failed
    ? say('error.couldNotJoin', language, { ssid: failed[1] ?? '', error: localize(failed[2] ?? '', language) })
    : message;
}
