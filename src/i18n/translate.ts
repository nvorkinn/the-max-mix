// t(): the tablet's words (strings.ts) in its language, with their arguments put in.

import { useCallback } from 'react';
import { IntlMessageFormat } from 'intl-messageformat';
import { useLanguage } from './language';
import type { Language } from './language';
import { STRINGS } from './strings';
import type { StringId } from './strings';

// Parsing a string is the slow part, so each is parsed once per language.
const formatters = new Map<string, IntlMessageFormat>();

/** The string for `id` in `language`, with `args` put in as they are (an argument is never parsed). */
export function translate(id: StringId, language: Language, args: Record<string, string | number> = {}): string {
  const key = `${language}:${id}`;
  let found = formatters.get(key);
  if (!found) {
    found = new IntlMessageFormat(STRINGS[id][language], language);
    formatters.set(key, found);
  }
  return String(found.format(args));
}

/** The kind of t() a component gets: an id and its arguments, in the tablet's language. */
export type Translate = (id: StringId, args?: Record<string, string | number>) => string;

/** t(), in the tablet's language (the nearest LanguageContext). */
export function useT(): Translate {
  const language = useLanguage();
  return useCallback((id, args) => translate(id, language, args), [language]);
}
