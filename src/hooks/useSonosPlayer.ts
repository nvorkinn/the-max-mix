// While a Sonos group plays what the kiosk sent it, the tablet shows that group's playback and its controls act on the
// group. Spotify does not report a Sonos playing from its own queue, so this reads the group through the Sonos Control
// API (the app's relay): its song, the next one, where in the song it is and its volume. The group is found by the room
// that leads it (getKioskSonosLeader), because a group's id changes when rooms join or leave it.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getGroupPlayback, getGroupVolume, listSonos, seekGroup, sendGroupCommand, setGroupVolume } from '../sonos/api';
import type { SonosCommand, SonosGroup, SonosPlayback, SonosTrack } from '../sonos/api';
import { getKioskSonosLeader, playOnSonosRoom, setKioskSonosLeader, subscribeKioskSonosLeader } from '../sonos/kiosk';
import type { PlaybackState, Track } from '../types';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';

/** How often the group is read while it plays and someone may be watching. */
const PLAYING_POLL_MS = 5000;
/** How often while it is paused, or the screen sleeps. */
const IDLE_POLL_MS = 30_000;
/** The group's name and rooms are read again every this many reads, to follow rooms joining or leaving. */
const REGROUP_EVERY = 6;
/** A read this long after a control, so the screen follows what the speaker did. */
const AFTER_CONTROL_MS = 800;
/** Failed reads in a row before the tablet says so. */
const FAILURES_TO_SHOW = 3;
const VOLUME_DELAY_MS = 250;

export interface SonosPlayer {
  /** Whether the tablet follows a Sonos group (the kiosk started a song on it). */
  active: boolean;
  /** The group's name, once read. */
  name: string | null;
  /** The group's playback in the shape the player shows; null until read. */
  playback: PlaybackState | null;
  /** The song Sonos plays next, when it says. */
  next: Track[];
  error: string | null;
  togglePlay: () => Promise<boolean>;
  nextTrack: () => Promise<boolean>;
  previousTrack: () => Promise<boolean>;
  seek: (positionMs: number) => Promise<boolean>;
  /** 0 to 100. */
  setVolume: (volume: number) => void;
  /** Plays a Spotify item on the group's leading room, through the Pi. */
  play: (uri: string) => Promise<boolean>;
  /** Reads the group again now. */
  refresh: () => void;
  /** Stops following the group, pausing it first (so the music does not play in two places). */
  leave: () => Promise<void>;
  /** Nobody is watching (the screen sleeps): read the group less often. */
  setSlowPolling: (slow: boolean) => void;
}

interface Reading {
  playback: SonosPlayback;
  /** When it was read (Date.now()), to move the position on between reads. */
  at: number;
}

const toTrack = (track: SonosTrack): Track => ({
  ...(track.uri && { id: track.uri.slice('spotify:track:'.length), uri: track.uri }),
  name: track.name,
  artists: track.artist ? [{ name: track.artist }] : [],
  album: { images: track.imageUrl ? [{ url: track.imageUrl }] : [] },
  ...(track.durationMs && { duration_ms: track.durationMs })
});

function toPlaybackState(group: SonosGroup, reading: Reading, volume: number | null, now: number): PlaybackState {
  const { playback } = reading;
  const duration = playback.track?.durationMs;
  const moved = playback.playing ? Math.max(0, now - reading.at) : 0;
  const progress = playback.positionMs + moved;
  return {
    is_playing: playback.playing,
    progress_ms: duration ? Math.min(duration, progress) : progress,
    device: {
      id: `sonos:${group.playerIds[0] ?? group.id}`,
      name: group.name,
      type: 'Speaker',
      is_active: true,
      volume_percent: volume,
      supports_volume: volume !== null
    },
    ...(playback.track && { item: toTrack(playback.track) }),
    shuffle_state: false,
    repeat_state: 'off',
    actions: {
      disallows: {
        seeking: !playback.canSeek,
        skipping_next: !playback.canSkip,
        skipping_prev: !playback.canSkipBack,
        toggling_shuffle: true,
        toggling_repeat_context: true,
        toggling_repeat_track: true
      }
    }
  };
}

/** The Sonos group whose rooms include the leading room, or undefined when it is gone. */
async function findGroup(leader: string): Promise<SonosGroup | undefined> {
  const { groups } = await listSonos();
  return groups.find(group => group.playerIds.includes(leader));
}

export function useSonosPlayer(): SonosPlayer {
  const [slowPolling, setSlowPolling] = useState(false);
  const leader = useSyncExternalStore(subscribeKioskSonosLeader, getKioskSonosLeader);
  const [group, setGroup] = useState<SonosGroup | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [volume, setVolume] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [readVersion, setReadVersion] = useState(0);
  const groupRef = useRef<SonosGroup | null>(null);
  const volumeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A new leading room (or none) starts afresh.
  const [followed, setFollowed] = useState(leader);
  if (followed !== leader) {
    setFollowed(leader);
    setGroup(null);
    setReading(null);
    setVolume(null);
    setError(null);
  }

  const playing = Boolean(reading?.playback.playing);
  useEffect(() => {
    if (!leader) return;
    let cancelled = false;
    // Read through a function: TypeScript narrows the flag to `false` and cannot see the cleanup flip it mid-await.
    const isCancelled = () => cancelled;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reads = 0;
    let failures = 0;
    groupRef.current = null;
    const read = async () => {
      let delay = slowPolling ? IDLE_POLL_MS : PLAYING_POLL_MS;
      try {
        let current = groupRef.current;
        if (!current || reads % REGROUP_EVERY === 0) {
          const found = await findGroup(leader);
          if (isCancelled()) return;
          if (!found) {
            debugLog('info', 'sonos', 'The Sonos room the kiosk played on is gone; following Spotify again.');
            setKioskSonosLeader(null);
            return;
          }
          if (found.id !== current?.id) {
            const level = await getGroupVolume(found.id).catch(() => null);
            if (isCancelled()) return;
            setVolume(level);
          }
          current = found;
          groupRef.current = found;
          setGroup(found);
        }
        const playback = await getGroupPlayback(current.id);
        if (isCancelled()) return;
        const at = Date.now();
        setReading({ playback, at });
        setNow(at);
        setError(null);
        reads++;
        failures = 0;
        if (!playback.playing) delay = IDLE_POLL_MS;
      } catch (caught) {
        if (isCancelled()) return;
        // The group may have changed its id (rooms joined or left): find it again on the next read.
        groupRef.current = null;
        reads = 0;
        failures++;
        debugLog('warn', 'sonos', `Reading the Sonos group failed: ${errorMessage(caught)}`);
        if (failures >= FAILURES_TO_SHOW) setError(errorMessage(caught));
        delay = Math.min(IDLE_POLL_MS, PLAYING_POLL_MS * failures);
      }
      timer = setTimeout(() => void read(), delay);
    };
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [leader, slowPolling, readVersion]);

  // The position moves on each second between reads while the group plays.
  useEffect(() => {
    if (!playing || slowPolling) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [playing, slowPolling]);

  useEffect(() => () => clearTimeout(volumeTimerRef.current), []);

  const refresh = useCallback(() => setReadVersion(version => version + 1), []);

  /** Runs a control on the group; reads it again shortly after. False (and the reason shown) when it failed. */
  const control = useCallback(
    async (run: (groupId: string) => Promise<void>): Promise<boolean> => {
      const current = groupRef.current;
      if (!current) return false;
      try {
        await run(current.id);
        setError(null);
        return true;
      } catch (caught) {
        setError(errorMessage(caught));
        return false;
      } finally {
        setTimeout(refresh, AFTER_CONTROL_MS);
      }
    },
    [refresh]
  );

  const command = useCallback((name: SonosCommand) => control(groupId => sendGroupCommand(groupId, name)), [control]);

  const togglePlay = useCallback(async () => {
    const wasPlaying = Boolean(reading?.playback.playing);
    // Show the change at once; the next read corrects it if the speaker did otherwise.
    setReading(current => current && { playback: { ...current.playback, playing: !wasPlaying }, at: Date.now() });
    return command(wasPlaying ? 'pause' : 'play');
  }, [command, reading]);

  const seek = useCallback(
    (positionMs: number) => {
      setReading(current => current && { playback: { ...current.playback, positionMs }, at: Date.now() });
      return control(groupId => seekGroup(groupId, positionMs));
    },
    [control]
  );

  const changeVolume = useCallback((level: number) => {
    setVolume(level);
    clearTimeout(volumeTimerRef.current);
    volumeTimerRef.current = setTimeout(() => {
      const current = groupRef.current;
      if (current) setGroupVolume(current.id, level).catch((caught: unknown) => setError(errorMessage(caught)));
    }, VOLUME_DELAY_MS);
  }, []);

  const play = useCallback(
    async (uri: string) => {
      const room = groupRef.current?.rooms[0];
      if (!room) return false;
      try {
        await playOnSonosRoom(room, uri);
        setError(null);
        refresh();
        return true;
      } catch (caught) {
        setError(errorMessage(caught));
        return false;
      }
    },
    [refresh]
  );

  const leave = useCallback(async () => {
    const current = groupRef.current;
    setKioskSonosLeader(null);
    if (!current) return;
    await sendGroupCommand(current.id, 'pause').catch((caught: unknown) =>
      debugLog('warn', 'sonos', `Pausing the Sonos failed: ${errorMessage(caught)}`)
    );
  }, []);

  return {
    active: leader !== null,
    name: group?.name ?? null,
    playback: group && reading ? toPlaybackState(group, reading, volume, now) : null,
    next: reading?.playback.next ? [toTrack(reading.playback.next)] : [],
    error,
    togglePlay,
    nextTrack: useCallback(() => command('skipToNextTrack'), [command]),
    previousTrack: useCallback(() => command('skipToPreviousTrack'), [command]),
    seek,
    setVolume: changeVolume,
    play,
    refresh,
    leave,
    setSlowPolling
  };
}
