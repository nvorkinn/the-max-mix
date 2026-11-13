// The shapes every lyrics source hands back, so the panel does not care which source found the words.

/** One word (with the space after it) of a line whose source times every word; `timeMs` is when it is sung. */
export interface SyncedWord {
  timeMs: number;
  text: string;
}

/**
 * A line of time-synced lyrics; `timeMs` is when it starts. An empty `text` is an instrumental gap. `words` is there
 * only when the source times each word; joined, they make `text`.
 */
export interface SyncedLine {
  timeMs: number;
  text: string;
  words?: SyncedWord[];
}

export type Lyrics =
  | { kind: 'synced'; lines: SyncedLine[]; source: string }
  | { kind: 'plain'; lines: string[]; source: string }
  | { kind: 'instrumental'; source: string };

/** What a source needs to look a track up. */
export interface LyricsQuery {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
}

/**
 * A lyrics source. It resolves to null when it has no lyrics for the track and rejects when it could not be reached.
 * To try another source, write one of these and hand it to `useLyrics`.
 */
export type LyricsProvider = (query: LyricsQuery, signal: AbortSignal) => Promise<Lyrics | null>;
