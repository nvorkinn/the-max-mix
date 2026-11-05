import { describe, expect, it, vi } from 'vitest';
import type { Candidate, LyricsQuery, LyricsSource } from './lyrics-sources.ts';
import { cached, findLyrics, isSynced, matches, normalize, parseLyricsQuery, searchTitle } from './lyrics.ts';
import type { LyricsHit } from './lyrics.ts';

const LRC = ['[00:01.00]One', '[00:02.00]Two', '[00:03.00]Three', '[00:04.00]Four'].join('\n');
const query = { title: 'Placeholder Song', artist: 'Placeholder Artist', durationMs: 200_000 };
const song = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: '1',
  title: 'Placeholder Song',
  artist: 'Placeholder Artist',
  durationMs: 200_000,
  ...overrides
});
const source = (name: string, candidates: Candidate[], lrc: string | null = LRC): LyricsSource => ({
  name,
  search: vi.fn().mockResolvedValue(candidates),
  lyrics: vi.fn().mockResolvedValue(lrc)
});
const get = () => Promise.reject(new Error('unused'));

describe('kiosk-audio/lyrics', () => {
  it('reads the request', () => {
    expect(parseLyricsQuery(new URLSearchParams('title= A &artist=B&duration=1500'))).toEqual({
      title: 'A',
      artist: 'B',
      durationMs: 1500
    });
    expect(parseLyricsQuery(new URLSearchParams('title=A&artist=B&duration=nope'))).toEqual({
      title: 'A',
      artist: 'B'
    });
    expect(parseLyricsQuery(new URLSearchParams('title=A'))).toBeNull();
  });

  it('normalizes titles and artists', () => {
    expect(normalize('Yesterday - Remastered 2009')).toBe('yesterday');
    expect(normalize('Café (feat. Someone) [Live]')).toBe('cafe');
    expect(normalize('Beyoncé ft. Jay-Z')).toBe('beyonce');
  });

  it('searches without the parts of a title that only skew a search', () => {
    expect(searchTitle('Yesterday - Remastered 2009')).toBe('Yesterday');
    expect(searchTitle('Song (feat. Someone) [Live]')).toBe('Song');
    expect(searchTitle('Live - Forever')).toBe('Live - Forever');
    expect(searchTitle('(Brackets Only)')).toBe('(Brackets Only)');
  });

  it('keeps only the song asked for, the exact title and closest length first', () => {
    const unknownLength = song({ id: 'unknown-length' });
    delete unknownLength.durationMs;
    const found = matches(
      [
        song({ id: 'other-artist', artist: 'Someone Else' }),
        song({ id: 'long', durationMs: 260_000 }),
        song({ id: 'partial', title: 'Placeholder Song Extended', durationMs: 200_100 }),
        song({ id: 'far', durationMs: 205_000 }),
        song({ id: 'near', durationMs: 200_500 }),
        song({ id: 'bracketed', title: 'Placeholder Song (Deluxe)', durationMs: 201_000 }),
        unknownLength
      ],
      query
    );
    expect(found.map(candidate => candidate.id)).toEqual(['unknown-length', 'near', 'bracketed', 'far', 'partial']);
  });

  it('tells synced lyrics from stubs', () => {
    expect(isSynced(LRC)).toBe(true);
    expect(isSynced('[00:01.00]Only\n[00:02.00]Two')).toBe(false);
    expect(isSynced('Plain\ntext\nonly\nhere')).toBe(false);
  });

  it('takes the first source that has the lyrics', async () => {
    const later = source('C', [song()]);
    const hit = await findLyrics(query, [source('A', []), source('B', [song()]), later], get);
    expect(hit).toEqual({ source: 'B', lrc: LRC });
    expect(later.search).not.toHaveBeenCalled();
  });

  it('moves on from lyrics that are not synced', async () => {
    const hit = await findLyrics(query, [source('A', [song()], 'Plain text'), source('B', [song()])], get);
    expect(hit?.source).toBe('B');
  });

  it('skips a failing source, and reports the failure only when nothing was found', async () => {
    vi.spyOn(console, 'warn').mockReturnValue();
    const failing: LyricsSource = { ...source('A', []), search: () => Promise.reject(new Error('A is down')) };
    const withSong = source('B', [song()]);
    const withoutSong = source('B', []);
    await expect(findLyrics(query, [failing, withSong], get)).resolves.toMatchObject({ source: 'B' });
    await expect(findLyrics(query, [failing, withoutSong], get)).rejects.toThrow('A is down');
    await expect(findLyrics(query, [withoutSong], get)).resolves.toBeNull();
  });

  it('remembers what it found, and what it did not for an hour', async () => {
    let time = 0;
    const hit: LyricsHit = { source: 'A', lrc: LRC };
    const find = vi
      .fn<(q: LyricsQuery) => Promise<LyricsHit | null>>()
      .mockResolvedValueOnce(hit)
      .mockResolvedValue(null);
    const lookup = cached(find, () => time);
    await expect(lookup(query)).resolves.toBe(hit);
    await expect(lookup({ ...query, title: 'placeholder song!' })).resolves.toBe(hit);
    expect(find).toHaveBeenCalledTimes(1);
    const other = { ...query, title: 'Other' };
    await expect(lookup(other)).resolves.toBeNull();
    await expect(lookup(other)).resolves.toBeNull();
    expect(find).toHaveBeenCalledTimes(2);
    time = 61 * 60 * 1000;
    await lookup(other);
    expect(find).toHaveBeenCalledTimes(3);
  });

  it('does not remember a failure', async () => {
    const find = vi
      .fn<(q: LyricsQuery) => Promise<LyricsHit | null>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(null);
    const lookup = cached(find);
    await expect(lookup(query)).rejects.toThrow('down');
    await expect(lookup(query)).resolves.toBeNull();
  });
});
