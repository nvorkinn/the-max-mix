import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { STRINGS } from './strings';
import { translate } from './translate';

describe('translate', () => {
  it('says each string in the language asked for', () => {
    expect(translate('general.language', 'en')).toBe('Language');
    expect(translate('general.language', 'nb')).toBe(STRINGS['general.language'].nb);
  });

  it('puts the arguments in', () => {
    expect(translate('general.minutes', 'nb', { minutes: 5 })).toBe('5 min');
  });

  it('has every string in both languages, each one a message that parses', () => {
    for (const id of Object.keys(STRINGS) as (keyof typeof STRINGS)[]) {
      for (const language of ['en', 'nb'] as const) {
        expect(STRINGS[id][language], `${id} in ${language}`).not.toBe('');
        expect(() => new IntlMessageFormat(STRINGS[id][language], language)).not.toThrow();
      }
    }
  });
});
