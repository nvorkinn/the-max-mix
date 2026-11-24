// cspell:ignore Velg telefonen
import { describe, expect, it, vi } from 'vitest';
import type { Language } from '../i18n/language';
import { translate } from '../i18n/translate';
import type { Translate } from '../i18n/translate';
import { describePlayback } from './PlaybackNotice';

const fixes = { onSettings: vi.fn(), onChooseSpeaker: vi.fn(), onRefresh: vi.fn(), onReconnect: vi.fn() };
const inLanguage =
  (language: Language): Translate =>
  (id, args) =>
    translate(id, language, args);

describe('describePlayback', () => {
  it("names the kiosk's Soloist as it reported itself when it asks for it to be picked on a phone", () => {
    const notice = {
      kind: 'problem',
      problem: { message: '', recovery: 'pick-on-phone', device: 'The Max Mix 4' }
    } as const;
    expect(describePlayback(notice, inLanguage('en'), fixes).title).toBe('Pick The Max Mix 4 in Spotify on your phone');
    expect(describePlayback(notice, inLanguage('nb'), fixes).title).toBe('Velg The Max Mix 4 i Spotify på telefonen');
  });

  it('asks for this kiosk to be picked before Soloist has said its name', () => {
    const notice = { kind: 'problem', problem: { message: '', recovery: 'pick-on-phone' } } as const;
    expect(describePlayback(notice, inLanguage('en'), fixes).title).toBe('Pick this kiosk in Spotify on your phone');
  });
});
