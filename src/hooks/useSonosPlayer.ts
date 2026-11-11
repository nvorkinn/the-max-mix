// While a Sonos group plays what the kiosk sent it, the tablet shows that group's playback and its controls act on the
// group. Spotify does not report a Sonos playing from its own queue, so this asks the Pi (src/sonos/kiosk.ts), which
// asks the speakers on the home network: the song, where in it the group is, its volume and its artwork. The group is
// followed by the room that leads it (getKioskSonosLeader), as rooms join and leave it. The Pi says when the speakers
// change (watchSonosOnPi), so the group is read then; while it does, the regular reads are only a slow fallback.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  controlSonos,
  findSonosOnPi,
  getKioskSonosLeader,
  getSonosArt,
  getSonosNow,
  playOnSonosRoom,
  setKioskSonosLeader,
  setSonosVolume,
  subscribeKioskSonosLeader,
  watchSonosOnPi
} from '../sonos/kiosk';
import type { PiSonosNow, SonosAction } from '../sonos/kiosk';
import type { PlaybackState, Track } from '../types';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';

/** How often the group is read while it plays and someone may be watching. */
const PLAYING_POLL_MS = 5000;
/** How often while it is paused, or the screen sleeps. */
const IDLE_POLL_MS = 30_000;
/** How often while the Pi says when the speakers change: only to catch a change it missed. */
const LIVE_POLL_MS = 60_000;
/** A read this long after the Pi says the speakers changed, so a burst of changes is read once. */
const AFTER_CHANGE_MS = 150;
/** The group's rooms are read again every this many reads, to follow rooms joining or leaving. */
const REGROUP_EVERY = 6;
/** A read this long after a control, so the screen follows what the speaker did. */
const AFTER_CONTROL_MS = 800;
/** Failed reads in a row before the tablet says so. */
const FAILURES_TO_SHOW = 3;
const VOLUME_DELAY_MS = 250;

export interface SonosPlayer {
  /** Whether the tablet follows a Sonos group (the kiosk started a song on it). */
  active: boolean;
  /** The group's name, e.g. "Kitchen + 1", once read. */
  name: string | null;
  /** The group's playback in the shape the player shows; null until read. */
  playback: PlaybackState | null;
  /** The song Sonos plays next, when it says (it does not yet). */
  next: Track[];
  error: string | null;
  togglePlay: () => Promise<boolean>;
  nextTrack: () => Promise<boolean>;
  previousTrack: () => Promise<boolean>;
  seek: (positionMs: number) => Promise<boolean>;
  /** 0 to 100. */
  setVolume: (volume: number) => void;
  /** Plays a Spotify item on the group, through the Pi. */
  play: (uri: string) => Promise<boolean>;
  /** Reads the group again now. */
  refresh: () => void;
  /** Stops following the group, pausing it first (so the music does not play in two places). */
  leave: () => Promise<void>;
  /** Nobody is watching (the screen sleeps): read the group less often. */
  setSlowPolling: (slow: boolean) => void;
}

interface Reading {
  now: PiSonosNow;
  /** When it was read (Date.now()), to move the position on between reads. */
  at: number;
}

const NO_TRACKS: Track[] = [];

function toPlaybackState(
  room: string,
  name: string,
  reading: Reading,
  art: string | null,
  volume: number | null,
  now: number
): PlaybackState {
  const { now: status } = reading;
  const track = status.track;
  const duration = track?.durationMs;
  const progress = status.positionMs + (status.playing ? Math.max(0, now - reading.at) : 0);
  return {
    is_playing: status.playing,
    progress_ms: duration ? Math.min(duration, progress) : progress,
    device: {
      id: `sonos:${room}`,
      name,
      type: 'Speaker',
      is_active: true,
      volume_percent: volume,
      supports_volume: volume !== null
    },
    ...(track && {
      item: {
        ...(track.uri && { id: track.uri.slice('spotify:track:'.length), uri: track.uri }),
        name: track.name,
        artists: track.artist ? [{ name: track.artist }] : [],
        album: { images: art ? [{ url: art }] : [] },
        ...(duration && { duration_ms: duration })
      }
    }),
    shuffle_state: false,
    repeat_state: 'off',
    actions: {
      disallows: {
        seeking: !status.canSeek,
        toggling_shuffle: true,
        toggling_repeat_context: true,
        toggling_repeat_track: true
      }
    }
  };
}

/** "Kitchen", or "Kitchen + 1" for a group of two, the way the Sonos app names a group. */
const groupName = (rooms: readonly string[]) => (rooms.length > 1 ? `${rooms[0]} + ${rooms.length - 1}` : rooms[0]);

export function useSonosPlayer(): SonosPlayer {
  const [slowPolling, setSlowPolling] = useState(false);
  const leader = useSyncExternalStore(subscribeKioskSonosLeader, getKioskSonosLeader);
  const [name, setName] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [volume, setVolume] = useState<number | null>(null);
  // The artwork read for a song (by artKey), as an object URL.
  const [artwork, setArtwork] = useState<{ key: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [readVersion, setReadVersion] = useState(0);
  const volumeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A new leading room (or none) starts afresh.
  const [followed, setFollowed] = useState(leader);
  if (followed !== leader) {
    setFollowed(leader);
    setName(null);
    setReading(null);
    setVolume(null);
    setError(null);
  }

  const playing = Boolean(reading?.now.playing);
  useEffect(() => {
    if (!leader) return;
    let cancelled = false;
    // Read through a function: TypeScript narrows the flag to `false` and cannot see the cleanup flip it mid-await.
    const isCancelled = () => cancelled;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reads = 0;
    let failures = 0;
    let isReading = false;
    // A change the Pi reported while a read was under way: read again once it ends.
    let isStale = false;
    const changedMeanwhile = () => isStale;
    let isLive = false;
    const schedule = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void read(), delay);
    };
    const read = async () => {
      isReading = true;
      isStale = false;
      let delay = slowPolling ? IDLE_POLL_MS : PLAYING_POLL_MS;
      try {
        if (reads % REGROUP_EVERY === 0) {
          const { groups } = await findSonosOnPi();
          if (isCancelled()) return;
          const rooms = groups.find(group => group.rooms.some(room => room.name === leader))?.rooms;
          if (!rooms) {
            debugLog('info', 'sonos', `${leader} is not on the network any more; following Spotify again.`);
            setKioskSonosLeader(null);
            return;
          }
          setName(groupName(rooms.map(room => room.name)) ?? leader);
        }
        const status = await getSonosNow(leader);
        if (isCancelled()) return;
        const at = Date.now();
        setReading({ now: status, at });
        setVolume(status.volume);
        setNow(at);
        setError(null);
        reads++;
        failures = 0;
        if (!status.playing) delay = IDLE_POLL_MS;
        if (isLive) delay = LIVE_POLL_MS;
      } catch (caught) {
        if (isCancelled()) return;
        reads = 0;
        failures++;
        debugLog('warn', 'sonos', `Reading the Sonos failed: ${errorMessage(caught)}`);
        if (failures >= FAILURES_TO_SHOW) setError(errorMessage(caught));
        delay = Math.min(IDLE_POLL_MS, PLAYING_POLL_MS * failures);
      } finally {
        isReading = false;
      }
      schedule(changedMeanwhile() ? AFTER_CHANGE_MS : delay);
    };
    const stopWatching = watchSonosOnPi(
      change => {
        // Rooms joined or left: read the group's rooms again too.
        if (change === 'groups') reads = 0;
        if (isReading) isStale = true;
        else schedule(AFTER_CHANGE_MS);
      },
      live => {
        isLive = live;
      }
    );
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopWatching();
    };
  }, [leader, slowPolling, readVersion]);

  // The song's artwork, read again when the song changes.
  const track = reading?.now.track;
  const artKey = leader && track?.art ? `${leader}\n${track.uri ?? track.name}` : null;
  useEffect(() => {
    if (!artKey || !leader) return;
    let live = true;
    let url: string | null = null;
    void getSonosArt(leader).then(blob => {
      if (!live || !blob) return;
      url = URL.createObjectURL(blob);
      setArtwork({ key: artKey, url });
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [artKey, leader]);
  const art = artKey && artwork?.key === artKey ? artwork.url : null;

  // The position moves on each second between reads while the group plays.
  useEffect(() => {
    if (!playing || slowPolling) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [playing, slowPolling]);

  useEffect(() => () => clearTimeout(volumeTimerRef.current), []);

  const refresh = useCallback(() => setReadVersion(version => version + 1), []);

  /** Runs a call on the group; reads it again shortly after. False (and the reason shown) when it failed. */
  const run = useCallback(
    async (call: (room: string) => Promise<void>): Promise<boolean> => {
      if (!leader) return false;
      try {
        await call(leader);
        setError(null);
        return true;
      } catch (caught) {
        setError(errorMessage(caught));
        return false;
      } finally {
        setTimeout(refresh, AFTER_CONTROL_MS);
      }
    },
    [leader, refresh]
  );

  const control = useCallback(
    (action: SonosAction, positionMs?: number) => run(room => controlSonos(room, action, positionMs)),
    [run]
  );

  const togglePlay = useCallback(async () => {
    const wasPlaying = Boolean(reading?.now.playing);
    // Show the change at once; the next read corrects it if the speaker did otherwise.
    setReading(current => current && { now: { ...current.now, playing: !wasPlaying }, at: Date.now() });
    return control(wasPlaying ? 'pause' : 'play');
  }, [control, reading]);

  const seek = useCallback(
    (positionMs: number) => {
      setReading(current => current && { now: { ...current.now, positionMs }, at: Date.now() });
      return control('seek', positionMs);
    },
    [control]
  );

  const changeVolume = useCallback(
    (level: number) => {
      setVolume(level);
      clearTimeout(volumeTimerRef.current);
      volumeTimerRef.current = setTimeout(() => {
        if (leader) setSonosVolume(leader, level).catch((caught: unknown) => setError(errorMessage(caught)));
      }, VOLUME_DELAY_MS);
    },
    [leader]
  );

  const leave = useCallback(async () => {
    setKioskSonosLeader(null);
    if (!leader) return;
    await controlSonos(leader, 'pause').catch((caught: unknown) =>
      debugLog('warn', 'sonos', `Pausing the Sonos failed: ${errorMessage(caught)}`)
    );
  }, [leader]);

  return {
    active: leader !== null,
    name,
    playback: leader && reading ? toPlaybackState(leader, name ?? leader, reading, art, volume, now) : null,
    next: NO_TRACKS,
    error,
    togglePlay,
    nextTrack: useCallback(() => control('next'), [control]),
    previousTrack: useCallback(() => control('previous'), [control]),
    seek,
    setVolume: changeVolume,
    play: useCallback((uri: string) => run(room => playOnSonosRoom(room, uri)), [run]),
    refresh,
    leave,
    setSlowPolling
  };
}
