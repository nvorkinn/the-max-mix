import { useEffect, useRef, useState } from 'react';
import { MicVocal, RotateCcw, Timer } from 'lucide-react';
import { useLyrics } from '../hooks/useLyrics';
import { activeLineIndex } from '../lyrics/lrc';
import type { LyricsProvider } from '../lyrics/types';
import type { Track } from '../types';

interface LyricsPanelProps {
  track?: Track | undefined;
  progressMs: number;
  /** Whether the song is playing, so the lyrics can move on between position updates. */
  playing?: boolean;
  /** False while the panel is out of sight, so a hidden panel looks nothing up. */
  shown?: boolean;
  provider?: LyricsProvider;
}

/** React keys for lyric lines: the words plus an occurrence counter, since choruses repeat. */
function lineKeys(lines: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return lines.map(line => {
    const occurrence = seen.get(line) ?? 0;
    seen.set(line, occurrence + 1);
    return `${line}#${occurrence}`;
  });
}

/** After this long without touching the lyrics, they follow the song again. */
const FOLLOW_RESUME_MS = 8000;

/** The speakers play a little behind the reported position, so each line lights up this much ahead of its timestamp. */
const LYRICS_LEAD_MS = 500;

/** The furthest a tap in sync mode moves the lyrics' timing, so a slip of the finger cannot throw them far off. */
const MAX_SYNC_SHIFT_MS = 10_000;

/** How often the lyrics work out the position between the player's own updates, which come about once a second. */
const SMOOTH_STEP_MS = 100;
/** The furthest the lyrics run on from the last position update, in case updates stop without a pause. */
const MAX_RUN_ON_MS = 2000;

/**
 * The playback position, moved on between the player's once-a-second updates while the song plays, so that lines and
 * words light up on time rather than at the next update.
 */
function useSmoothProgress(progressMs: number, running: boolean): number {
  const [tick, setTick] = useState({ progressMs, elapsed: 0 });
  useEffect(() => {
    if (!running) return;
    const start = performance.now();
    const timer = setInterval(() => setTick({ progressMs, elapsed: performance.now() - start }), SMOOTH_STEP_MS);
    return () => clearInterval(timer);
  }, [progressMs, running]);
  return running && tick.progressMs === progressMs ? progressMs + Math.min(tick.elapsed, MAX_RUN_ON_MS) : progressMs;
}

function EmptyState({ title, text }: Readonly<{ title: string; text: string }>) {
  return (
    <div className="queue-empty">
      <div className="empty-record">
        <MicVocal size={28} strokeWidth={1.25} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function LyricsPanelContent({
  track,
  progressMs,
  playing = false,
  shown = true,
  provider
}: Readonly<LyricsPanelProps>) {
  const { status, lyrics, error, retry } = useLyrics(track, shown, provider);
  // A tap in sync mode moves this song's lyrics earlier or later; the panel is remade for every song, so it starts at 0.
  const [shiftMs, setShiftMs] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const smooth = useSmoothProgress(progressMs, playing && shown && lyrics?.kind === 'synced');
  const position = smooth + LYRICS_LEAD_MS + shiftMs;
  const listRef = useRef<HTMLOListElement | null>(null);
  const [isFollowing, setIsFollowing] = useState(true);
  // The same as isFollowing, but set the moment the reader touches the list. A line change rendered just before the touch
  // runs its scroll effect just after it, with the old isFollowing; this stops that scroll from undoing the reader's.
  const followingRef = useRef(true);
  const active = lyrics?.kind === 'synced' ? activeLineIndex(lyrics.lines, position) : -1;

  useEffect(() => {
    const list = listRef.current;
    if (!list || lyrics?.kind !== 'synced') return;
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;
    // Reading pauses the following; leaving the lyrics alone for a while picks it up again.
    const pauseFollow = () => {
      followingRef.current = false;
      setIsFollowing(false);
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        followingRef.current = true;
        setIsFollowing(true);
      }, FOLLOW_RESUME_MS);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pauseFollow();
    };
    list.addEventListener('wheel', pauseFollow, { passive: true });
    list.addEventListener('pointerdown', pauseFollow);
    list.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(resumeTimer);
      list.removeEventListener('wheel', pauseFollow);
      list.removeEventListener('pointerdown', pauseFollow);
      list.removeEventListener('keydown', onKeyDown);
    };
  }, [lyrics]);

  // The list is positioned, so a line's offsetTop is measured from the list's top.
  useEffect(() => {
    const list = listRef.current;
    const line = list?.children[Math.max(0, active)];
    if (!isFollowing || !list || !followingRef.current || lyrics?.kind !== 'synced' || !(line instanceof HTMLElement)) {
      return;
    }
    list.scrollTop = line.offsetTop - list.clientHeight / 2 + line.clientHeight / 2;
  }, [active, lyrics, isFollowing]);

  /** Sync mode: the tapped line is the one being sung now, so the timing moves to match, and the mode ends. */
  const syncTo = (lineMs: number) => {
    const shift = lineMs - (smooth + LYRICS_LEAD_MS);
    setShiftMs(Math.max(-MAX_SYNC_SHIFT_MS, Math.min(MAX_SYNC_SHIFT_MS, shift)));
    setIsSyncing(false);
    followingRef.current = true;
    setIsFollowing(true);
  };

  const body = () => {
    switch (status) {
      case 'idle': {
        return <EmptyState title="Nothing to sing along to yet." text="Play a song and its lyrics show up here." />;
      }
      case 'loading': {
        return (
          <div className="queue-empty" role="status">
            <p>Looking for the lyrics...</p>
          </div>
        );
      }
      case 'error': {
        return (
          <div className="queue-empty">
            <p role="alert" className="queue-error">
              {error}
            </p>
            <button type="button" className="button button-secondary" onClick={retry}>
              <RotateCcw size={14} /> Try again
            </button>
          </div>
        );
      }
      default:
    }
    if (!lyrics) {
      return <EmptyState title="No lyrics for this one." text="The lyrics database does not have this song yet." />;
    }
    if (lyrics.kind === 'instrumental') return <EmptyState title="Instrumental." text="No words, just the music." />;
    // An empty synced line is an instrumental break.
    const lines = lyrics.kind === 'synced' ? lyrics.lines.map(line => line.text || '\u{266A}') : lyrics.lines;
    const keys = lineKeys(lines);
    return (
      <ol
        ref={listRef}
        className={`lyrics-list ${lyrics.kind === 'synced' ? 'is-synced' : ''}`}
        data-following={isFollowing}
        data-syncing={isSyncing}
        // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- Keyboard users need focus for native list scrolling.
        tabIndex={0}
        aria-label={`Lyrics of ${track?.name || track?.title || 'this song'}`}
      >
        {lines.map((line, idx) => {
          // The line being sung lights up word by word when its source times each word, otherwise all at once.
          const words = idx === active && lyrics.kind === 'synced' ? lyrics.lines[idx]?.words : undefined;
          const lineMs = lyrics.kind === 'synced' ? lyrics.lines[idx]?.timeMs : undefined;
          const content = words
            ? words.map(word => (
                <span
                  key={`${word.timeMs}:${word.text}`}
                  className={`lyrics-word ${word.timeMs <= position ? 'is-reached' : ''}`}
                >
                  {word.text}
                </span>
              ))
            : line || '\u{A0}';
          return (
            <li
              key={keys[idx]}
              className={`lyrics-line ${idx < active || (idx === active && !words) ? 'is-reached' : ''}`}
              aria-current={idx === active ? 'true' : undefined}
            >
              {isSyncing && lineMs !== undefined ? (
                <button type="button" className="lyrics-sync-line" onClick={() => syncTo(lineMs)}>
                  {content}
                </button>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ol>
    );
  };

  return (
    <div className="lyrics-panel" role="region" aria-label="Lyrics">
      {body()}
      {status === 'ready' && lyrics?.kind === 'synced' && (
        <button
          type="button"
          className="lyrics-sync-button"
          aria-label="Sync lyrics: tap the line being sung"
          aria-pressed={isSyncing}
          onClick={() => setIsSyncing(syncing => !syncing)}
        >
          <Timer size={24} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

/** A track change resets reading mode, including when returning to a previously viewed song. */
export default function LyricsPanel(props: Readonly<LyricsPanelProps>) {
  const { track } = props;
  const key =
    track?.id ||
    track?.uri ||
    JSON.stringify([track?.name || track?.title, track?.artists?.[0]?.name || track?.artist]);
  return <LyricsPanelContent key={key} {...props} />;
}
