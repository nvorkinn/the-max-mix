// The shapes lyrics come in, whichever source the kiosk service found them at.

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
  durationMs?: number;
}

/**
 * Something that looks lyrics up: the kiosk service (kiosk.ts), or a stand-in for it in a test. It resolves to null
 * when there are no lyrics for the track and rejects when it could not look.
 */
export type LyricsProvider = (query: LyricsQuery, signal: AbortSignal) => Promise<Lyrics | null>;
