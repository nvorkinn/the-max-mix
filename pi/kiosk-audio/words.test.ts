import { describe, expect, it } from 'vitest';
import { ERRORS } from './nmcli.ts';
import { languageOfTag, localize, parseLanguage, preferredLanguage, say } from './words.ts';

describe('kiosk-audio/words', () => {
  it('fills in the arguments, and leaves a placeholder it has no argument for', () => {
    expect(say('wifi.joinNetwork', 'en', { ssid: 'Home' })).toBe('Join Home');
    expect(say('wifi.signal', 'en', { bars: 3 })).toBe('Signal 3 of 4');
    expect(say('wifi.joinNetwork', 'en')).toBe('Join {ssid}');
    // A network's name is filled in as it is, even when it looks like a placeholder.
    expect(say('wifi.connecting', 'en', { ssid: '{ssid}' })).toBe('Connecting to {ssid}…');
  });

  it('takes nb as Norwegian and anything else as English', () => {
    expect(parseLanguage('nb')).toBe('nb');
    for (const other of ['en', 'no', 'NB', 'de', '', null, undefined, 1, {}]) expect(parseLanguage(other)).toBe('en');
    expect(languageOfTag('nb-NO')).toBe('nb');
    expect(languageOfTag('nb')).toBe('nb');
    expect(languageOfTag('en-GB')).toBe('en');
    expect(languageOfTag('')).toBe('en');
  });

  it('picks the language a phone prefers of the ones it has', () => {
    expect(preferredLanguage('nb-NO,nb;q=0.9,en;q=0.8')).toBe('nb');
    expect(preferredLanguage('no')).toBe('nb');
    expect(preferredLanguage('nn-NO, en;q=0.5')).toBe('nb');
    expect(preferredLanguage('en-US,en;q=0.9,nb;q=0.8')).toBe('en');
    expect(preferredLanguage('fr-FR, nb;q=0.3')).toBe('nb');
    expect(preferredLanguage('en;q=0.2, nb;q=0.7')).toBe('nb');
    expect(preferredLanguage('nb;q=0, en')).toBe('en');
    expect(preferredLanguage('sv-SE')).toBe('en');
    expect(preferredLanguage('')).toBe('en');
    expect(preferredLanguage()).toBe('en');
  });

  it('knows every message the Wi-Fi service sends, so the page can show it in Norwegian', () => {
    for (const message of Object.values(ERRORS)) {
      expect(localize(message, 'nb'), message).not.toBe(message);
      expect(localize(message, 'en')).toBe(message);
    }
    expect(localize('Could not join Home: Bar: Could not connect.', 'nb')).toBe(
      say('error.couldNotJoin', 'nb', { ssid: 'Home: Bar', error: say('error.generic', 'nb') })
    );
    expect(localize('Something new.', 'nb')).toBe('Something new.');
  });
});
