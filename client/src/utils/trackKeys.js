// React keys for a list of tracks. Queue entries are not guaranteed to carry an id (demo data, Spotify local files)
// and the same track can legitimately appear twice, so build the key deliberately: the track's own identity plus an
// occurrence counter for repeats. Unlike the list index, this key follows the track when the queue is reordered.
/**
 * @param {import('../types.js').Track[]} tracks
 * @returns {string[]}
 */
export function trackKeys(tracks) {
  const seen = /** @type {Map<string, number>} */ (new Map());
  return tracks.map(track => {
    const artist = track.artists ? track.artists.map(a => a.name).join(',') : track.artist;
    const base = track.id ?? track.uri ?? `${track.name || track.title}|${artist}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return occurrence === 0 ? base : `${base}#${occurrence}`;
  });
}
