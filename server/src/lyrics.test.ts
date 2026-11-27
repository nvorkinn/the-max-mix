import { describe, expect, it, vi, type Mock } from 'vitest';
import { SourceResting } from './lyrics-sources.ts';
import type { Candidate, GetJson, LyricsQuery, LyricsSource } from './lyrics-sources.ts';
import {
  afterPause,
  cached,
  findLyrics,
  isSynced,
  isWordTimed,
  matches,
  normalize,
  parseLyricsQuery,
  searchTitle
} from './lyrics.ts';
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
const WORDS = [1, 2, 3, 4].map(second => `[00:0${second}.000]<00:0${second}.000>One <00:0${second}.500>two`).join('\n');
/** A source with line-timed lyrics (`lrc`) and, when given, word-timed ones. */
const source = (
  name: string,
  candidates: Candidate[],
  lrc: string | null = LRC,
  words: string | null = null
): LyricsSource => ({
  name,
  search: vi.fn().mockResolvedValue(candidates),
  words: vi.fn().mockResolvedValue(words),
  lines: vi.fn().mockResolvedValue(lrc)
});
/** A source that also keeps plain lyrics. */
const withPlain = (candidates: Candidate[], plain: string | null): LyricsSource & { plain: Mock } => ({
  ...source('A', candidates, null),
  plain: vi.fn().mockResolvedValue(plain)
});
const get = () => Promise.reject(new Error('unused'));

describe('server/lyrics', () => {
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

  it('tells lyrics that time each word from ones that time whole lines', () => {
    expect(isWordTimed(WORDS)).toBe(true);
    expect(isWordTimed(LRC)).toBe(false);
    const wholeLines = [1, 2, 3, 4].map(second => `[00:0${second}.000]<00:0${second}.000>One<00:0${second}.500>`);
    expect(isWordTimed(wholeLines.join('\n'))).toBe(false);
    expect(isWordTimed(WORDS.split('\n').slice(0, 3).join('\n'))).toBe(false);
  });

  it('takes the first source that has line-timed lyrics when none times the words', async () => {
    const later = source('C', [song()]);
    const hit = await findLyrics(query, [source('A', []), source('B', [song()]), later], get);
    expect(hit).toEqual({ source: 'B', lrc: LRC });
    expect(later.words).toHaveBeenCalledTimes(1);
    expect(later.lines).not.toHaveBeenCalled();
  });

  it('asks every source for word-timed lyrics before any for line-timed ones', async () => {
    const first = source('A', [song()]);
    const second = source('B', [song()]);
    const last = source('C', [song()], LRC, WORDS);
    await expect(findLyrics(query, [first, second, last], get)).resolves.toEqual({ source: 'C', lrc: WORDS });
    expect(first.words).toHaveBeenCalledTimes(1);
    expect(second.words).toHaveBeenCalledTimes(1);
    expect(first.lines).not.toHaveBeenCalled();
    expect(second.lines).not.toHaveBeenCalled();
  });

  it('takes the earliest source that times the words, and a later match of a source when its first does not', async () => {
    const both = [
      source('A', [song()], LRC, WORDS),
      source('B', [song()], LRC, `${WORDS}\n[00:09.000]<00:09.000>More`)
    ];
    await expect(findLyrics(query, both, get)).resolves.toEqual({ source: 'A', lrc: WORDS });
    const second: LyricsSource = {
      ...source('A', [song({ id: 'first' }), song({ id: 'second' })]),
      words: candidate => Promise.resolve(candidate.id === 'second' ? WORDS : LRC)
    };
    await expect(findLyrics(query, [second], get)).resolves.toEqual({ source: 'A', lrc: WORDS });
  });

  it('falls back to the line-timed lyrics of a source whose word-timed ones could not be read', async () => {
    vi.spyOn(console, 'warn').mockReturnValue();
    const broken: LyricsSource = { ...source('A', [song()]), words: () => Promise.reject(new Error('unreadable')) };
    await expect(findLyrics(query, [broken], get)).resolves.toEqual({ source: 'A', lrc: LRC });
    const empty: LyricsSource = { ...broken, lines: () => Promise.reject(new Error('down')) };
    await expect(findLyrics(query, [empty], get)).rejects.toThrow('unreadable');
  });

  it('settles for plain lyrics only when no source has synced ones', async () => {
    const plain = withPlain([song()], 'Plain\ntext');
    const synced = source('B', [song()]);
    await expect(findLyrics(query, [plain, synced], get)).resolves.toEqual({ source: 'B', lrc: LRC });
    expect(plain.plain).not.toHaveBeenCalled();
    const without = source('B', [song()], null);
    await expect(findLyrics(query, [without, plain], get)).resolves.toEqual({ source: 'A', plain: 'Plain\ntext' });
    const blank = withPlain([song()], ' \n');
    await expect(findLyrics(query, [blank], get)).resolves.toBeNull();
  });

  it('takes a source at its word that the song is instrumental, unless an earlier one has synced lyrics', async () => {
    const instrumental = source('A', [song({ isInstrumental: true })], null);
    const later = source('B', [song()]);
    await expect(findLyrics(query, [instrumental, later], get)).resolves.toEqual({ source: 'A', instrumental: true });
    expect(later.lines).not.toHaveBeenCalled();
    await expect(findLyrics(query, [later, instrumental], get)).resolves.toEqual({ source: 'B', lrc: LRC });
    // Word-timed lyrics anywhere still come first.
    const timed = source('B', [song()], LRC, WORDS);
    await expect(findLyrics(query, [instrumental, timed], get)).resolves.toEqual({ source: 'B', lrc: WORDS });
  });

  it('does not ask for a kind of lyrics a match is known to lack, and tries three matches at most', async () => {
    const has = { words: false, lines: true, plain: false };
    const songs = [song({ id: 'no-words', has }), song({ id: 'words', has: { ...has, words: true } })];
    const known = withPlain(songs, 'x');
    await findLyrics(query, [known], get);
    expect(known.words).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'words' }), get);
    expect(known.lines).toHaveBeenCalledTimes(2);
    expect(known.plain).not.toHaveBeenCalled();
    const four = ['1', '2', '3', '4'].map(id => song({ id }));
    const many = source('B', four, null);
    await findLyrics(query, [many], get);
    expect(many.words).toHaveBeenCalledTimes(3);
    expect(many.lines).toHaveBeenCalledTimes(3);
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

  it('remembers lyrics that are not synced for an hour only', async () => {
    let time = 0;
    const find = vi
      .fn<(q: LyricsQuery) => Promise<LyricsHit | null>>()
      .mockResolvedValueOnce({ source: 'A', plain: 'Plain' })
      .mockResolvedValue({ source: 'A', lrc: LRC });
    const lookup = cached(find, () => time);
    await expect(lookup(query)).resolves.toEqual({ source: 'A', plain: 'Plain' });
    await expect(lookup(query)).resolves.toEqual({ source: 'A', plain: 'Plain' });
    time = 61 * 60 * 1000;
    await expect(lookup(query)).resolves.toEqual({ source: 'A', lrc: LRC });
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('does not log each lookup a resting source fails, but still tells that it could not look', async () => {
    const warn = vi.spyOn(console, 'warn').mockReturnValue();
    const resting: LyricsSource = {
      ...source('A', []),
      search: () => Promise.reject(new SourceResting('lrclib.net asked not to be called for a while'))
    };
    const without = source('B', []);
    const withSong = source('B', [song()]);
    await expect(findLyrics(query, [resting, without], get)).rejects.toBeInstanceOf(SourceResting);
    await expect(findLyrics(query, [resting, withSong], get)).resolves.toMatchObject({ source: 'B' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('sends no more requests once the lookup is no longer wanted', async () => {
    const warn = vi.spyOn(console, 'warn').mockReturnValue();
    const gone = new AbortController();
    const urls: string[] = [];
    const reach = vi.fn<GetJson>(url => {
      urls.push(url);
      if (url === 'search') gone.abort(new Error('hung up'));
      return Promise.resolve(url === 'search' ? [song()] : LRC);
    });
    const asking: LyricsSource = {
      name: 'A',
      search: async (_query, getJson) => (await getJson('search')) as Candidate[],
      words: async (_candidate, getJson) => (await getJson('words')) as string,
      lines: async (_candidate, getJson) => (await getJson('lines')) as string
    };
    await expect(findLyrics(query, [asking], reach, gone.signal)).rejects.toThrow('hung up');
    expect(urls).toEqual(['search']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('waits a moment before looking, and does not look for a song given up on meanwhile', async () => {
    const hit: LyricsHit = { source: 'A', lrc: LRC };
    const find = vi.fn<(q: LyricsQuery, signal?: AbortSignal) => Promise<LyricsHit | null>>().mockResolvedValue(hit);
    const lookup = afterPause(find, 20);
    const skipped = new AbortController();
    const asked = lookup(query, skipped.signal);
    skipped.abort();
    await expect(asked).rejects.toThrow();
    expect(find).not.toHaveBeenCalled();
    const kept = new AbortController();
    await expect(lookup(query, kept.signal)).resolves.toBe(hit);
    expect(find).toHaveBeenCalledExactlyOnceWith(query, kept.signal);
  });

  it('answers a song it remembers at once, without the pause, and hands the signal on', async () => {
    const hit: LyricsHit = { source: 'A', lrc: LRC };
    const find = vi.fn<(q: LyricsQuery, signal?: AbortSignal) => Promise<LyricsHit | null>>().mockResolvedValue(hit);
    const lookup = cached(afterPause(find, 20));
    const signal = new AbortController().signal;
    await expect(lookup(query, signal)).resolves.toBe(hit);
    expect(find).toHaveBeenCalledExactlyOnceWith(query, signal);
    // Already given up on: the pause would reject, so this answer did not wait for it.
    await expect(lookup(query, AbortSignal.abort())).resolves.toBe(hit);
    expect(find).toHaveBeenCalledOnce();
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
