import { useCallback, useState } from 'react';

/** What the panel between the artwork and the right-hand buttons shows. */
export type PanelView = 'queue' | 'lyrics' | 'speakers';

/** Whether the song playing has lyrics to show: still being looked up, found, or none (no song, none found, instrumental). */
export type LyricsAvailability = 'unknown' | 'found' | 'none';

const SUITS: Readonly<Record<LyricsAvailability, 'queue' | 'lyrics' | null>> = {
  unknown: null,
  found: 'lyrics',
  none: 'queue'
};

/**
 * Which view the middle panel shows. The lyrics show whenever the song has them, and the queue when it has none; while
 * a song's lyrics are looked up, the panel stays as it was (the lyrics, before anything is known), so it does not flick
 * to the queue and back. A tapped Queue or Lyrics holds, whichever tab is shown meanwhile, until music starts playing
 * again: a song other than the one paused on, so a pause and play keeps it, as does the queue playing on. Speakers holds until another button is tapped.
 *
 * `track` identifies the song playing or paused, null with none.
 */
export function usePanelView(lyrics: LyricsAvailability, playing: boolean, track: string | null) {
  const [picked, setPicked] = useState<PanelView | null>(null);
  // Whether music was playing, and the song last seen playing: music starts when a song other than that one starts to play
  // after nothing was playing. The next song in the queue playing on is not music starting.
  const [last, setLast] = useState({ playing, track });
  const [settled, setSettled] = useState<'queue' | 'lyrics' | null>(null);
  // Adjusted during render, not in an effect, so the panel never shows a stale choice for a frame.
  if (playing !== last.playing || (playing && track !== last.track)) {
    const started = playing && !last.playing && track !== last.track;
    setLast({ playing, track: playing ? track : last.track });
    if (started && picked !== 'speakers') setPicked(null);
  }
  const suits = SUITS[lyrics];
  if (suits && suits !== settled) setSettled(suits);
  const view: PanelView = picked ?? suits ?? settled ?? 'lyrics';
  /** Drops the view tapped, so the panel shows the song's own view again: its lyrics, or the queue when it has none. */
  const showDefault = useCallback(() => setPicked(null), []);
  return { view, show: (next: PanelView) => setPicked(next), showDefault };
}
