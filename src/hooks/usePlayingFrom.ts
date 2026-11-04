import { useEffect, useState } from 'react';
import { getContextName } from '../spotify/api';
import type { PlaybackState } from '../types';

// Names already looked up, by context URI, so going back to a playlist names it at once and asks Spotify only once.
const names = new Map<string, string>();

/** Forgets the looked-up names; for tests. */
export function clearPlayingFromNames() {
  names.clear();
}

/**
 * The name the state itself gives its context: Spotify's own name, "Liked Songs", or an album's name from the track.
 * Undefined when it has to be looked up.
 */
function nameInState(playback: PlaybackState): string | undefined {
  const context = playback.context;
  if (!context) return undefined;
  if (context.name) {
    // A later Web API read of the same context has no name, so the SDK's is kept.
    names.set(context.uri, context.name);
    return context.name;
  }
  if (context.type === 'collection' || context.uri.endsWith(':collection')) return 'Liked Songs';
  if (context.type === 'album' || context.uri.startsWith('spotify:album:')) return playback.item?.album?.name;
  return names.get(context.uri);
}

/**
 * What "Playing from" names: the playlist, album or artist the music plays from, or null when it is unknown or a track
 * plays on its own. Names the state lacks (a playlist's, an artist's) are read once from the Web API; until that answers
 * the line is left out rather than showing a placeholder.
 */
export function usePlayingFrom(playback: PlaybackState | null | undefined): string | null {
  const uri = playback?.context?.uri ?? null;
  const known = playback ? nameInState(playback) : undefined;
  const [lookedUp, setLookedUp] = useState<{ uri: string; name: string | null } | null>(null);
  const lookUp = uri !== null && known === undefined ? uri : null;
  useEffect(() => {
    if (!lookUp) return;
    let cancelled = false;
    void getContextName(lookUp)
      .catch(() => null)
      .then(name => {
        if (name) names.set(lookUp, name);
        if (!cancelled) setLookedUp({ uri: lookUp, name });
      });
    return () => {
      cancelled = true;
    };
  }, [lookUp]);
  if (uri === null) return null;
  if (known !== undefined) return known || null;
  return lookedUp?.uri === uri ? lookedUp.name : null;
}
