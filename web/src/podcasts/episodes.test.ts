// cspell:ignore dagsnytt atten Abels taarn
import { describe, expect, it } from 'vitest';
import type { StoredPodcasts } from 'countdown-api';
import fixture from '../../../vendor/countdown-api/src/countdown_api/fixtures/podcasts.json';
import {
  continueListening,
  formatClock,
  formatDay,
  formatLength,
  fractionOf,
  isPartListened,
  progressOf,
  startPosition
} from './episodes';

const PODCASTS = fixture.value as StoredPodcasts;
const NONE = new Map();

describe('continueListening', () => {
  it('lists the part-listened episodes of every show, newest first', () => {
    const [dagsnytt, abel] = PODCASTS.shows;
    if (!dagsnytt || !abel) throw new Error('the fixture has two shows');
    const older = {
      ...abel,
      episodes: abel.episodes.map(episode => ({ ...episode, progress: { position_s: 60, finished: false } }))
    };
    const items = continueListening({ ...PODCASTS, shows: [older, dagsnytt] }, NONE);
    expect(items.map(item => item.episode.id)).toEqual([
      'l_00000000-0000-4000-8000-000000000001',
      'l_00000000-0000-4000-8000-000000000003'
    ]);
    expect(items[1]?.show.id).toBe('abels_taarn');
  });

  it("goes by this kiosk's progress where it has some", () => {
    const local = new Map([['l_00000000-0000-4000-8000-000000000001', { position_s: 0, finished: true }]]);
    expect(continueListening(PODCASTS, local)).toEqual([]);
    expect(continueListening(null, NONE)).toEqual([]);
  });
});

describe('progress', () => {
  const episode = PODCASTS.shows[0]?.episodes[0];
  if (!episode) throw new Error('the fixture has an episode');

  it('is the kiosk’s own over NRK’s', () => {
    expect(progressOf(episode, NONE)).toEqual({ position_s: 1027, finished: false });
    const local = new Map([[episode.id, { position_s: 2000, finished: false }]]);
    expect(progressOf(episode, local)).toEqual({ position_s: 2000, finished: false });
  });

  it('starts where it was left, unless finished or never started', () => {
    expect(isPartListened(null)).toBe(false);
    expect(startPosition({ position_s: 1027, finished: false })).toBe(1027);
    expect(startPosition({ position_s: 0, finished: true })).toBe(0);
    expect(startPosition(null)).toBe(0);
  });

  it('is a fraction of the length, full when finished', () => {
    expect(fractionOf({ position_s: 900, finished: false }, 3600)).toBe(0.25);
    expect(fractionOf({ position_s: 0, finished: true }, 3600)).toBe(1);
    expect(fractionOf(null, 3600)).toBe(0);
    expect(fractionOf({ position_s: 9000, finished: false }, 3600)).toBe(1);
    expect(fractionOf({ position_s: 10, finished: false }, 0)).toBe(0);
  });
});

describe('formatting', () => {
  it('writes the player’s clock, with hours past an hour', () => {
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(3725.9)).toBe('1:02:05');
    expect(formatClock(-3)).toBe('0:00');
  });

  it('writes an episode’s length in hours and minutes', () => {
    expect(formatLength(3539, 'en')).toBe('59 mins');
    expect(formatLength(3600, 'en')).toBe('1 hr');
    expect(formatLength(3900, 'en')).toBe('1 hr 5 mins');
    expect(formatLength(20, 'en')).toBe('1 min');
    expect(formatLength(3900, 'nb')).toBe('1 t 5 min');
  });

  it('writes the day, with the year only when it is not this one', () => {
    const now = new Date('2026-11-28T12:00:00Z');
    expect(formatDay('2026-11-27T17:00:00+00:00', 'en', now)).toBe('27 Nov');
    expect(formatDay('2025-11-27T17:00:00+00:00', 'en', now)).toBe('27 Nov 2025');
    expect(formatDay('2026-11-27T17:00:00+00:00', 'nb', now)).toBe('27. nov.');
  });
});
