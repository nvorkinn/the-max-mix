import { describe, it, expect } from 'vitest';
import { isTrackByFemaleSinger, findFemaleSingersInQueue } from './femaleSingers';

describe('isTrackByFemaleSinger', () => {
  it('reports no match for missing tracks', () => {
    expect(isTrackByFemaleSinger(null)).toEqual({ isFemale: false, artist: null });
    expect(isTrackByFemaleSinger(undefined)).toEqual({ isFemale: false, artist: null });
  });

  it('matches artists given as objects or strings, case-insensitively', () => {
    expect(isTrackByFemaleSinger({ artists: [{ name: 'Some Band' }, { name: 'ADELE' }] })).toEqual({
      isFemale: true,
      artist: 'adele'
    });
    expect(
      isTrackByFemaleSinger(
        /** @type {import('../types').Track} */ (/** @type {unknown} */ ({ artists: ['Dua Lipa'] }))
      ).isFemale
    ).toBe(true);
  });

  it('splits comma separated artist strings', () => {
    expect(isTrackByFemaleSinger({ artist: 'Nobody, Cher' })).toEqual({ isFemale: true, artist: 'cher' });
  });

  it('reports no match for unknown artists or tracks without artist info', () => {
    expect(isTrackByFemaleSinger({ artist: 'Metallica' })).toEqual({ isFemale: false, artist: null });
    expect(isTrackByFemaleSinger({ title: 'x' })).toEqual({ isFemale: false, artist: null });
  });

  it('does not flag unrelated artists whose names merely contain a catalog entry', () => {
    expect(isTrackByFemaleSinger({ artist: 'Asia' }).isFemale).toBe(false);
    expect(isTrackByFemaleSinger({ artist: 'Cherry Poppin Daddies' }).isFemale).toBe(false);
    expect(isTrackByFemaleSinger({ artist: 'Madonnas Of Rock' }).isFemale).toBe(false);
  });

  it('still matches catalog names with accents, punctuation or extra words', () => {
    expect(isTrackByFemaleSinger({ artist: 'Céline Dion' }).isFemale).toBe(true);
    expect(isTrackByFemaleSinger({ artist: 'St. Vincent' }).isFemale).toBe(true);
    expect(isTrackByFemaleSinger({ artist: 'Florence + The Machine' }).isFemale).toBe(true);
    expect(isTrackByFemaleSinger({ artist: 'Sia' }).isFemale).toBe(true);
    expect(isTrackByFemaleSinger({ artist: 'Cher feat. Nobody' }).isFemale).toBe(true);
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
