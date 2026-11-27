// The words the notice board says, from countdown-api's catalog (vendor/countdown-api's messages/notices.json): ICU
// MessageFormat strings by id, the same ones the e-paper screens are worded with, so both say the same thing. The
// strings keep to named arguments, `select` and `plural`; a date or a time is formatted by whoever asks and passed in
// as text. Each string is in English and Norwegian, as the tablet is (its config's language).

import { IntlMessageFormat } from 'intl-messageformat';
import catalog from '../../../vendor/countdown-api/src/countdown_api/messages/notices.json';
import type { Language } from '../i18n/language';
import { DEFAULT_LANGUAGE } from '../i18n/language';

/** An id the catalog has: any other is a compile error. */
type MessageId = keyof typeof catalog;

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
export function say(
  id: MessageId,
  args: Record<string, string | number> = {},
  language: Language = DEFAULT_LANGUAGE
): string {
  return String(formatter(id, language).format(args));
}
