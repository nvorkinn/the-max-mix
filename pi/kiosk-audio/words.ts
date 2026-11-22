// The words of this service, in English and Norwegian Bokmål: the hotspot's page for a phone (hotspot-portal.ts), which
// follows the phone's language, and the service's own messages. The app has its own catalogue (src/i18n); this service
// ships to the Pi on its own, so it keeps this small one. The app imports it too (src/utils/kioskWifi.ts, for
// `localize`), so it imports nothing.
// `{name}` in a text is filled in from `say`'s arguments.

/** English (en) or Norwegian Bokmål (nb), as the app's config names them. */
export type Language = 'en' | 'nb';

/** Each language's tag for `<html lang>`. */
export const LOCALES: Readonly<Record<Language, string>> = { en: 'en-GB', nb: 'nb-NO' };

const WORDS = {
  // The hotspot's page on a phone.
  'portal.networkName': { en: 'Network name', nb: 'Nettverksnavn' },
  'portal.password': { en: 'Password', nb: 'Passord' },
  'portal.passwordFor': { en: 'Password for {ssid}', nb: 'Passord for {ssid}' },
  'portal.connect': { en: 'Connect', nb: 'Koble til' },
  'portal.connectTo': { en: 'Connect to {ssid}', nb: 'Koble til {ssid}' },
  'portal.back': { en: 'Back', nb: 'Tilbake' },
  'portal.otherNetwork': { en: 'Other network…', nb: 'Annet nettverk …' },
  'portal.joining': { en: 'The tablet is joining {ssid}', nb: 'Nettbrettet kobler til {ssid}' },
  'portal.loadFailed': {
    en: 'Could not load the networks. Reload this page.',
    nb: 'Kunne ikke hente nettverkene. Last inn siden på nytt.'
  },
  'portal.refused': {
    en: 'The kiosk did not accept that. Check the name and password.',
    nb: 'Nettbrettet godtok ikke det. Sjekk navnet og passordet.'
  },

  // The service's own messages, which reach the app in English (nmcli.ts, hotspot.ts, server.ts): the app shows them in
  // its language with `localize`.
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
  'error.forget': { en: 'Could not forget the network.', nb: 'Kunne ikke glemme nettverket.' },
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
  'error.phoneJoinFailed': { en: 'Could not join that network.', nb: 'Kunne ikke koble til det nettverket.' },
  'error.couldNotJoin': { en: 'Could not join {ssid}: {error}', nb: 'Kunne ikke koble til {ssid}: {error}' }
} as const satisfies Record<string, Readonly<Record<Language, string>>>;

export type WordId = keyof typeof WORDS;

/** The text for `id` in `language`, with each `{name}` filled in from `args` (left as it is when `args` has none). */
export function say(id: WordId, language: Language, args: Readonly<Record<string, string | number>> = {}): string {
  return WORDS[id][language].replaceAll(/\{(\w+)\}/g, (whole, name: string) => String(args[name] ?? whole));
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
