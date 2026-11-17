// The words the notice board says, from countdown-api's catalog (vendor/countdown-api's messages/notices.json): ICU
// MessageFormat strings by id, the same ones the e-paper screens are worded with, so both say the same thing. The
// strings keep to named arguments, `select` and `plural`; a date or a time is formatted by whoever asks and passed in
// as text. The touchscreen is in English; the catalog has each string in Norwegian too, for when it has a language.

import { IntlMessageFormat } from 'intl-messageformat';
import catalog from '../../vendor/countdown-api/src/countdown_api/messages/notices.json';

/** An id the catalog has: any other is a compile error. */
type MessageId = keyof typeof catalog;
/** The languages every string of the catalog is in. */
type Language = 'en' | 'nb';

// Parsing a string is the slow part, so each is parsed once per language.
const formatters = new Map<string, IntlMessageFormat>();

function formatter(id: MessageId, language: Language): IntlMessageFormat {
  const key = `${language}:${id}`;
  let found = formatters.get(key);
  if (!found) {
    found = new IntlMessageFormat(catalog[id][language], language);
    formatters.set(key, found);
  }
  return found;
}

/** The catalog's string for `id` in `language`, with `args` put in as they are (an argument is never parsed). */
export function say(id: MessageId, args: Record<string, string | number> = {}, language: Language = 'en'): string {
  return String(formatter(id, language).format(args));
}
