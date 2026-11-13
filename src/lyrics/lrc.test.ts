import { describe, expect, it } from 'vitest';
import { activeLineIndex, parseLrc } from './lrc';

describe('lyrics/lrc', () => {
  it('parses timestamps in minutes, seconds and hundredths', () => {
    expect(parseLrc('[00:01.50]Placeholder line A\n[01:02.25] Placeholder line B ')).toEqual([
      { timeMs: 1500, text: 'Placeholder line A' },
      { timeMs: 62_250, text: 'Placeholder line B' }
    ]);
  });

  it('accepts timestamps without a fraction, with milliseconds or with a colon', () => {
    expect(parseLrc('[00:02]A\n[00:03.125]B\n[00:04:50]C').map(line => line.timeMs)).toEqual([2000, 3125, 4500]);
  });

  it('repeats a line for every leading timestamp and sorts by time', () => {
    expect(parseLrc('[00:10.00][00:01.00]Chorus placeholder\r\n[00:05.00]Verse placeholder')).toEqual([
      { timeMs: 1000, text: 'Chorus placeholder' },
      { timeMs: 5000, text: 'Verse placeholder' },
      { timeMs: 10_000, text: 'Chorus placeholder' }
    ]);
  });

  it('reads the word times of enhanced LRC, keeping the plain text of the line', () => {
    expect(parseLrc('[00:01.00]<00:01.00>Placeholder <00:01.50>words <00:02.25>here<00:03.00>')).toEqual([
      {
        timeMs: 1000,
        text: 'Placeholder words here',
        words: [
          { timeMs: 1000, text: 'Placeholder ' },
          { timeMs: 1500, text: 'words ' },
          { timeMs: 2250, text: 'here' }
        ]
      }
    ]);
    // Text before the first word tag is sung with the line; a repeated line's word times follow its own timestamp.
    expect(parseLrc('[00:01.00][00:11.00]Lead <00:01.50>word')).toEqual([
      {
        timeMs: 1000,
        text: 'Lead word',
        words: [
          { timeMs: 1000, text: 'Lead ' },
          { timeMs: 1500, text: 'word' }
        ]
      },
      {
        timeMs: 11_000,
        text: 'Lead word',
        words: [
          { timeMs: 11_000, text: 'Lead ' },
          { timeMs: 11_500, text: 'word' }
        ]
      }
    ]);
  });

  it('keeps empty timed lines as breaks and drops metadata and untimed lines', () => {
    expect(parseLrc('[ar:Someone]\n[length:03:00]\nno time\n\n[00:01.00]\n[00:02.00]Line')).toEqual([
      { timeMs: 1000, text: '' },
      { timeMs: 2000, text: 'Line' }
    ]);
  });

  it('finds the line being sung', () => {
    const lines = parseLrc('[00:01.00]A\n[00:02.00]B\n[00:03.00]C');
    expect(activeLineIndex(lines, 0)).toBe(-1);
    expect(activeLineIndex(lines, 1000)).toBe(0);
    expect(activeLineIndex(lines, 2500)).toBe(1);
    expect(activeLineIndex(lines, 99_000)).toBe(2);
    expect(activeLineIndex([], 1000)).toBe(-1);
  });
});
