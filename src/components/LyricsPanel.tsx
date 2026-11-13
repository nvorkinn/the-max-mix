import { useEffect, useRef, useState } from 'react';
import { MicVocal, RotateCcw } from 'lucide-react';
import { useLyrics } from '../hooks/useLyrics';
import { activeLineIndex } from '../lyrics/lrc';
import type { LyricsProvider } from '../lyrics/types';
import type { Track } from '../types';

interface LyricsPanelProps {
  track?: Track | undefined;
  progressMs: number;
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

function LyricsPanelContent({ track, progressMs, shown = true, provider }: Readonly<LyricsPanelProps>) {
  const { status, lyrics, error, retry } = useLyrics(track, shown, provider);
  const listRef = useRef<HTMLOListElement | null>(null);
  const [isFollowing, setIsFollowing] = useState(true);
  // The same as isFollowing, but set the moment the reader touches the list. A line change rendered just before the touch
  // runs its scroll effect just after it, with the old isFollowing; this stops that scroll from undoing the reader's.
  const followingRef = useRef(true);
  const active = lyrics?.kind === 'synced' ? activeLineIndex(lyrics.lines, progressMs + LYRICS_LEAD_MS) : -1;

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
        // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- Keyboard users need focus for native list scrolling.
        tabIndex={0}
        aria-label={`Lyrics of ${track?.name || track?.title || 'this song'}`}
      >
        {lines.map((line, idx) => (
          <li
            key={keys[idx]}
            className={`lyrics-line ${idx <= active ? 'is-reached' : ''}`}
            aria-current={idx === active ? 'true' : undefined}
          >
            {line || '\u{A0}'}
          </li>
        ))}
      </ol>
    );
  };

  return (
    <div className="lyrics-panel" role="region" aria-label="Lyrics">
      {body()}
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
