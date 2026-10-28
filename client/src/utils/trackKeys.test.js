import { describe, it, expect } from 'vitest';
import { trackKeys } from './trackKeys.js';

describe('trackKeys', () => {
  it('uses id, then uri, then name and artist', () => {
    expect(
      trackKeys([
        { id: 'a' },
        { uri: 'spotify:x' },
        { name: 'Song', artists: [{ name: 'A' }, { name: 'B' }] },
        { title: 'T', artist: 'Z' }
      ])
    ).toEqual(['a', 'spotify:x', 'Song|A,B', 'T|Z']);
  });

  it('keeps keys unique for repeated tracks without using the position', () => {
    expect(trackKeys([{ id: 'a' }, { id: 'b' }, { id: 'a' }])).toEqual(['a', 'b', 'a#1']);
  });

  it('keeps a track key when other tracks are reordered', () => {
    const [first] = trackKeys([{ id: 'a' }, { id: 'b' }]);
    const reordered = trackKeys([{ id: 'b' }, { id: 'a' }]);
    expect(reordered[1]).toBe(first);
  });
});
