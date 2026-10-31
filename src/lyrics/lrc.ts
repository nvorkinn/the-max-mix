// LRC is the plain text format for synced lyrics: each line starts with one or more `[mm:ss.xx]` timestamps.
import type { SyncedLine } from './types';

const LEADING_TIMESTAMP = /^\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/;

/** The timed lines of an LRC text, in time order. Metadata tags such as `[ar:...]` and untimed lines are dropped. */
export function parseLrc(text: string): SyncedLine[] {
  const lines: SyncedLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let rest = raw.trim();
    const times: number[] = [];
    let match = LEADING_TIMESTAMP.exec(rest);
    while (match) {
      const minutes = Number(match[1]);
      const seconds = Number((match[2] ?? '0').replace(':', '.'));
      times.push(Math.round((minutes * 60 + seconds) * 1000));
      rest = rest.slice(match[0].length);
      match = LEADING_TIMESTAMP.exec(rest);
    }
    const words = rest.trim();
    for (const timeMs of times) lines.push({ timeMs, text: words });
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
