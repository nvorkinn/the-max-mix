import { useState } from 'react';

/** What the panel between the artwork and the right-hand buttons shows. */
export type PanelView = 'queue' | 'lyrics' | 'speakers';

/**
 * Which view the middle panel shows. The queue shows while songs are queued and the lyrics while it is empty. A tapped
 * Queue or Lyrics holds until the queue fills up or runs dry, when the panel goes back to what suits it. Speakers holds
 * until another button is tapped: the queue filling or emptying meanwhile does not take the panel away from it.
 *
 * `queueEmpty` is true only for a queue known to be empty (not one loading, failed or waiting for Spotify). `queueSettled`
 * is false while the queue is being read, so the panel does not change until the read is done.
 */
export function usePanelView(queueEmpty: boolean, queueSettled: boolean) {
  // What suits the queue as last read; null until it is first known, so the lyrics do not flash up while it is read.
  const [suited, setSuited] = useState<'queue' | 'lyrics' | null>(null);
  const [picked, setPicked] = useState<PanelView | null>(null);
  const suits = queueEmpty ? 'lyrics' : 'queue';
  // Adjusted during render, not in an effect, so the panel never shows a stale choice for a frame.
  if (queueSettled && suited !== suits) {
    setSuited(suits);
    if (picked !== 'speakers') setPicked(null);
  }
  const view: PanelView = picked ?? suited ?? 'queue';
  return { view, show: (next: PanelView) => setPicked(next) };
}
