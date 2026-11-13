// LRC is the plain text format for synced lyrics: each line starts with one or more `[mm:ss.xx]` timestamps. Enhanced
// LRC also times each word, with a `<mm:ss.xx>` tag before it.
import type { SyncedLine, SyncedWord } from './types';

const LEADING_TIMESTAMP = /^\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/;
const WORD_TIMESTAMP = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;

const toMs = (minutes: string | undefined, seconds = '0'): number =>
  Math.round((Number(minutes) * 60 + Number(seconds.replace(':', '.'))) * 1000);

/** A line's timed words (after its leading timestamps), if it has word tags; text before the first tag is sung at `lineMs`. */
function wordsOf(rest: string, lineMs: number): SyncedWord[] | undefined {
  // eslint-disable-next-line unicorn/prefer-iterator-to-array -- Iterator#toArray is not in this project's TypeScript lib.
  const tags = [...rest.matchAll(WORD_TIMESTAMP)];
  if (tags.length === 0) return undefined;
  const words: SyncedWord[] = [];
  const add = (timeMs: number, text: string) => {
    if (text) words.push({ timeMs, text });
  };
  add(lineMs, rest.slice(0, tags[0]?.index ?? rest.length).trimStart());
  for (const [index, tag] of tags.entries()) {
    const start = tag.index + tag[0].length;
    add(toMs(tag[1], tag[2]), rest.slice(start, tags[index + 1]?.index ?? rest.length));
  }
  const last = words.at(-1);
  if (last) last.text = last.text.trimEnd();
  return words.length > 0 ? words : undefined;
}

/** The timed lines of an LRC text, in time order. Metadata tags such as `[ar:...]` and untimed lines are dropped. */
export function parseLrc(text: string): SyncedLine[] {
  const lines: SyncedLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let rest = raw.trim();
    const times: number[] = [];
    let match = LEADING_TIMESTAMP.exec(rest);
    while (match) {
      times.push(toMs(match[1], match[2]));
      rest = rest.slice(match[0].length);
      match = LEADING_TIMESTAMP.exec(rest);
    }
    const words = rest.replaceAll(WORD_TIMESTAMP, '').trim();
    const first = times[0] ?? 0;
    const timed = wordsOf(rest, first);
    for (const timeMs of times) {
      // A line repeated under several timestamps has its words timed for the first; the others are shifted to match.
      const shifted = timed?.map(word => ({ ...word, timeMs: word.timeMs + timeMs - first }));
      lines.push(shifted ? { timeMs, text: words, words: shifted } : { timeMs, text: words });
    }
  }
  return lines.toSorted((a, b) => a.timeMs - b.timeMs);
}

/** The index of the line being sung at `positionMs`, or -1 before the first line. */
export function activeLineIndex(lines: readonly SyncedLine[], positionMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if ((lines[middle]?.timeMs ?? Infinity) <= positionMs) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
