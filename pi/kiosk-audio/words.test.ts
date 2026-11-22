import { describe, expect, it } from 'vitest';
import { ERRORS } from './nmcli.ts';
import { localize, preferredLanguage, say } from './words.ts';

describe('kiosk-audio/words', () => {
  it('fills in the arguments, and leaves a placeholder it has no argument for', () => {
    expect(say('error.couldNotJoin', 'en', { ssid: 'Home', error: 'Nope.' })).toBe('Could not join Home: Nope.');
    expect(say('error.couldNotJoin', 'en', { ssid: 'Home' })).toBe('Could not join Home: {error}');
    // A network's name is filled in as it is, even when it looks like a placeholder.
    expect(say('error.couldNotJoin', 'en', { ssid: '{error}', error: 'Nope.' })).toBe('Could not join {error}: Nope.');
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

  it('knows every message the Wi-Fi service sends, so the app can show it in Norwegian', () => {
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
