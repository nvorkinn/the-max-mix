import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { findRandomTrack } from '../spotify/api';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';
import { pauseFor, playingTrackIdOf } from '../spotify/songProof';
import type { Track } from '../types';
import { Artwork } from './TrackImages';
import QrCode from './QrCode';

/** How often the kiosk looks at what plays on the person's account, and for how long before it gives up. */
const POLL_MS = 2000;
const GIVE_UP_MS = 120_000;

/**
 * For someone whose phone the Pi does not hear: a random song, with a QR code that opens it on their phone. Once it
 * plays on their account, their playback is paused and `onProven` follows; after two minutes, or when no song could be
 * found, `onGiveUp`. The kiosk never plays the song itself.
 */
export default function SongProof({
  spotifyId,
  onProven,
  onGiveUp
}: Readonly<{ spotifyId: string; onProven: () => void; onGiveUp: () => void }>) {
  const [track, setTrack] = useState<Track | null>(null);
  // The latest callbacks, so a new one from the parent neither picks another song nor restarts the watching.
  const handlersRef = useRef({ onProven, onGiveUp });
  useLayoutEffect(() => {
    handlersRef.current = { onProven, onGiveUp };
  });

  useEffect(() => {
    let isCurrent = true;
    findRandomTrack()
      .then(found => {
        if (!isCurrent) return;
        if (found) setTrack(found);
        else {
          debugLog('warn', 'switcher', 'The random-song search found no song.');
          handlersRef.current.onGiveUp();
        }
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        debugLog('error', 'switcher', `Could not pick a random song: ${errorMessage(error)}`);
        handlersRef.current.onGiveUp();
      });
    return () => {
      isCurrent = false;
    };
  }, [spotifyId]);

  const trackId = track?.id;
  useEffect(() => {
    if (!trackId) return;
    let isCurrent = true;
    const check = async () => {
      const playing = await playingTrackIdOf(spotifyId).catch(() => null);
      if (!isCurrent || playing !== trackId) return;
      isCurrent = false;
      await pauseFor(spotifyId).catch(() => null);
      handlersRef.current.onProven();
    };
    const poll = setInterval(() => void check(), POLL_MS);
    const giveUp = setTimeout(() => handlersRef.current.onGiveUp(), GIVE_UP_MS);
    return () => {
      isCurrent = false;
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [spotifyId, trackId]);

  if (!track?.id) return <div className="song-proof song-proof-loading" aria-busy="true" />;
  const artist = (track.artists ?? [])
    .map(each => each.name)
    .filter(Boolean)
    .join(', ');
  return (
    <div className="song-proof">
      <Artwork src={track.album?.images?.[0]?.url} alt="" className="song-proof-art" />
      <div className="song-proof-text">
        <span className="song-proof-title">{track.name}</span>
        <span className="song-proof-artist">{artist}</span>
      </div>
      <QrCode text={`https://open.spotify.com/track/${track.id}`} className="song-proof-qr" />
    </div>
  );
}
