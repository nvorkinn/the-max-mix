import { describe, it, expect } from 'vitest';
import { isTrackByFemaleSinger, findFemaleSingersInQueue } from './femaleSingers.js';

describe('isTrackByFemaleSinger', () => {
  it('returns a falsy value for missing tracks', () => {
    expect(isTrackByFemaleSinger(null)).toBeFalsy();
  });

  it('matches artists given as objects or strings, case-insensitively', () => {
    expect(isTrackByFemaleSinger({ artists: [{ name: 'Some Band' }, { name: 'ADELE' }] })).toEqual({
      isFemale: true,
      artist: 'adele'
    });
    expect(/** @type {any} */ (isTrackByFemaleSinger({ artists: ['Dua Lipa'] })).isFemale).toBe(true);
  });

  it('splits comma separated artist strings', () => {
    expect(isTrackByFemaleSinger({ artist: 'Nobody, Cher' })).toEqual({ isFemale: true, artist: 'cher' });
  });

  it('reports no match for unknown artists or tracks without artist info', () => {
    expect(isTrackByFemaleSinger({ artist: 'Metallica' })).toEqual({ isFemale: false, artist: null });
    expect(isTrackByFemaleSinger({ title: 'x' })).toEqual({ isFemale: false, artist: null });
  });

  // Known bug: matching is by substring, so "Asia" contains "sia". Remove `.fails` once fixed.
  it.fails('does not flag unrelated artists whose names merely contain a catalog entry', () => {
    expect(/** @type {any} */ (isTrackByFemaleSinger({ artist: 'Asia' })).isFemale).toBe(false);
  });
});

describe('findFemaleSingersInQueue', () => {
  it('returns title and artist for matching tracks only', () => {
    const queue = [
      { name: 'Hello', artist: 'Adele' },
      { title: 'Enter Sandman', artist: 'Metallica' },
      { artist: 'Madonna' }
    ];
    expect(findFemaleSingersInQueue(queue)).toEqual([
      { trackTitle: 'Hello', artist: 'adele' },
      { trackTitle: 'Unknown Title', artist: 'madonna' }
    ]);
  });

  it('handles an empty or omitted queue', () => {
    expect(findFemaleSingersInQueue()).toEqual([]);
  });
});
