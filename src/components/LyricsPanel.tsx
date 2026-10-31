import { useEffect, useRef, useState } from 'react';
import { ListMusic, MicVocal, RotateCcw } from 'lucide-react';
import { useLyrics } from '../hooks/useLyrics';
import { activeLineIndex } from '../lyrics/lrc';
import type { LyricsProvider } from '../lyrics/types';
import type { Track } from '../types';

interface LyricsPanelProps {
  track?: Track | undefined;
  progressMs: number;
  onClose: () => void;
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

function LyricsPanelContent({ track, progressMs, onClose, provider }: Readonly<LyricsPanelProps>) {
  const { status, lyrics, error, retry } = useLyrics(track, true, provider);
  const listRef = useRef<HTMLOListElement | null>(null);
  const [isFollowing, setIsFollowing] = useState(true);
  const active = lyrics?.kind === 'synced' ? activeLineIndex(lyrics.lines, progressMs) : -1;

  useEffect(() => {
    const list = listRef.current;
    if (!list || lyrics?.kind !== 'synced') return;
    const pauseFollow = () => setIsFollowing(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pauseFollow();
    };
    list.addEventListener('wheel', pauseFollow, { passive: true });
    list.addEventListener('pointerdown', pauseFollow);
    list.addEventListener('keydown', onKeyDown);
    return () => {
      list.removeEventListener('wheel', pauseFollow);
      list.removeEventListener('pointerdown', pauseFollow);
      list.removeEventListener('keydown', onKeyDown);
    };
  }, [lyrics]);

  // The list is positioned, so a line's offsetTop is measured from the list's top.
  useEffect(() => {
    const list = listRef.current;
    const line = list?.children[Math.max(0, active)];
    if (!isFollowing || !list || lyrics?.kind !== 'synced' || !(line instanceof HTMLElement)) return;
    list.scrollTop = line.offsetTop - list.clientHeight / 2 + line.clientHeight / 2;
  }, [active, lyrics, isFollowing]);

  const followStatus = lyrics
    ? {
        plain: 'Not time-synced',
        instrumental: 'Instrumental',
        synced: isFollowing ? 'Follows the song' : 'Reading lyrics'
      }[lyrics.kind]
    : {
        idle: 'Play a song to see lyrics',
        loading: 'Looking for lyrics',
        missing: 'Lyrics unavailable',
        error: 'Lyrics unavailable',
        ready: 'Lyrics unavailable'
      }[status];

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
            className={`lyrics-line ${idx === active ? 'is-active' : ''} ${idx < active ? 'is-past' : ''}`}
            aria-current={idx === active ? 'true' : undefined}
          >
            {line || '\u{A0}'}
          </li>
        ))}
      </ol>
    );
  };

  return (
    <div className="queue-panel lyrics-panel">
      <div className="queue-heading">
        <div>
          <span className="eyebrow">
            <MicVocal size={14} /> Sing along
          </span>
          <h2>Lyrics</h2>
        </div>
        <button type="button" className="button button-secondary" onClick={onClose}>
          <ListMusic size={15} /> Up next
        </button>
      </div>
      {body()}
      <div className="queue-footer">
        <span aria-live="polite">{followStatus}</span>
        {lyrics?.kind === 'synced' && !isFollowing && (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setIsFollowing(true);
              listRef.current?.focus({ preventScroll: true });
            }}
          >
            <RotateCcw size={14} /> Follow song
          </button>
        )}
        {lyrics && (
          <span>
            {lyrics.source === 'LRCLIB' ? (
              <>
                Lyrics from{' '}
                <a href="https://lrclib.net" target="_blank" rel="noreferrer">
                  LRCLIB
                </a>
              </>
            ) : (
              `Lyrics from ${lyrics.source}`
            )}
          </span>
        )}
      </div>
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
