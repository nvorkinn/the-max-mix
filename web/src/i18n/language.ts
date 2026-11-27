// The language the tablet speaks: its config's (countdown-api's TouchscreenConfig.language), English until the kiosk has
// a config, and the locale its dates are written in.

import { createContext, use } from 'react';
import type { TouchscreenConfig } from 'countdown-api';

/** English (en) or Norwegian Bokmål (nb). */
export type Language = TouchscreenConfig['language'];

/** The language until countdown-server says otherwise, and for a config from before it had one. */
export const DEFAULT_LANGUAGE: Language = 'en';

/** Each language's locale, for Intl: British English, as the tablet has always written dates, or Norwegian Bokmål. */
export const LOCALES: Readonly<Record<Language, string>> = { en: 'en-GB', nb: 'nb-NO' };

export const LanguageContext = createContext<Language>(DEFAULT_LANGUAGE);

/** The tablet's language, from the nearest LanguageContext. */
export function useLanguage(): Language {
  return use(LanguageContext);
}
