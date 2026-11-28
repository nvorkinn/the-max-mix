import { useCallback, useEffect, useRef, useState } from 'react';
import type { PodcastProgress } from 'countdown-api';
import { attachSource } from '../podcasts/audio';
import { fetchPlayback, reportProgress } from '../podcasts/api';
import { progressOf, startPosition } from '../podcasts/episodes';
import type { LocalProgress, ShowEpisode } from '../podcasts/episodes';
import { ProgressReporter } from '../podcasts/reporter';
import { debugLog } from '../utils/debugLog';

/** How far the player's buttons jump back and forward, in seconds. */
export const BACK_S = 15;
export const FORWARD_S = 30;

/** `loading` while the server is asked what to play, `failed` when it couldn't say or the audio can't play. */
type PodcastPhase = 'loading' | 'ready' | 'failed';

export interface PodcastPlayer {
  /** The episode open in the player, or null for none. */
  current: ShowEpisode | null;
  phase: PodcastPhase;
  isPlaying: boolean;
  /** Seconds. */
  position: number;
  duration: number;
  /** This kiosk's progress on each episode it has played since the shows were read. */
  local: LocalProgress;
  /** Opens an episode and plays it, from where it was left unless it was finished. */
  open: (choice: ShowEpisode) => void;
  togglePlay: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  skip: (seconds: number) => void;
}

interface Session {
  choice: ShowEpisode;
  reporter: ProgressReporter | null;
  release: (() => void) | null;
}

/**
 * The Podcasts tab's player: one audio element for the whole app, so an episode plays on while another tab shows.
 * `onPlay` is called each time an episode starts or carries on playing, so the Spotify player can pause.
 */
export function usePodcastPlayer(onPlay: () => void): PodcastPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const onPlayRef = useRef(onPlay);
  useEffect(() => {
    onPlayRef.current = onPlay;
  });
  const [current, setCurrent] = useState<ShowEpisode | null>(null);
  const [phase, setPhase] = useState<PodcastPhase>('ready');
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [local, setLocal] = useState<LocalProgress>(() => new Map());

  const remember = useCallback((episodeId: string, progress: PodcastProgress) => {
    setLocal(previous => new Map(previous).set(episodeId, progress));
  }, []);

  const audio = useCallback(() => {
    if (!audioRef.current) {
      const element = new Audio();
      element.preload = 'auto';
      audioRef.current = element;
    }
    return audioRef.current;
  }, []);

  // The element's own events drive what shows and when NRK hears where playback is.
  useEffect(() => {
    const element = audio();
    const reporterOf = () => sessionRef.current?.reporter ?? null;
    const onPlaying = () => reporterOf()?.playing();
    const onPlayEvent = () => {
      setIsPlaying(true);
      onPlayRef.current();
    };
    const onPause = () => {
      setIsPlaying(false);
      reporterOf()?.stopped();
    };
    const onEnded = () => {
      setIsPlaying(false);
      reporterOf()?.stopped();
      const session = sessionRef.current;
      if (session) remember(session.choice.episode.id, { position_s: 0, finished: true });
    };
    const onSeeked = () => reporterOf()?.seeked(!element.paused);
    const onTime = () => setPosition(element.currentTime);
    const onDuration = () => {
      if (Number.isFinite(element.duration) && element.duration > 0) setDuration(element.duration);
    };
    const onError = () => {
      if (!sessionRef.current?.release) return;
      debugLog('warn', 'podcasts', `The episode's audio failed (${element.error?.code ?? '?'})`);
      setPhase('failed');
    };
    const listeners: [string, () => void][] = [
      ['playing', onPlaying],
      ['play', onPlayEvent],
      ['pause', onPause],
      ['ended', onEnded],
      ['seeked', onSeeked],
      ['timeupdate', onTime],
      ['durationchange', onDuration],
      ['error', onError]
    ];
    for (const [name, listener] of listeners) element.addEventListener(name, listener);
    return () => {
      for (const [name, listener] of listeners) element.removeEventListener(name, listener);
    };
  }, [audio, remember]);

  const close = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const element = audio();
    if (!element.paused) element.pause();
    // The pause's own event may not be heard any more (the app is closing), so the position is said here.
    session.reporter?.stopped();
    session.reporter?.dispose();
    session.release?.();
    sessionRef.current = null;
  }, [audio]);

  // Leaving the app (a reload, a person switch) stops the episode and says where it was.
  useEffect(() => close, [close]);

  const open = useCallback(
    (choice: ShowEpisode) => {
      close();
      const session: Session = { choice, reporter: null, release: null };
      sessionRef.current = session;
      const { show, episode } = choice;
      const start = startPosition(progressOf(episode, local));
      setCurrent(choice);
      setPhase('loading');
      setIsPlaying(false);
      setPosition(start);
      setDuration(episode.duration_s);
      void (async () => {
        const playback = await fetchPlayback(show.id, episode.id);
        if (sessionRef.current !== session) return;
        if (!playback) {
          setPhase('failed');
          return;
        }
        const element = audio();
        // NRK's progress now, which may be newer than the list's (another device played on).
        const from = startPosition(playback.progress ?? progressOf(episode, local));
        try {
          session.release = await attachSource(element, playback);
        } catch (caught) {
          debugLog('warn', 'podcasts', `Can't play the episode: ${String(caught)}`);
          if (sessionRef.current === session) setPhase('failed');
          return;
        }
        if (sessionRef.current !== session) {
          session.release();
          return;
        }
        session.reporter = new ProgressReporter(
          playback.report,
          () => element.currentTime,
          positionS => {
            remember(episode.id, { position_s: positionS, finished: false });
            void reportProgress(show.id, episode.id, positionS);
          },
          from
        );
        element.currentTime = from;
        setPosition(from);
        if (playback.duration_s > 0) setDuration(playback.duration_s);
        setPhase('ready');
        element.play().catch((caught: unknown) => {
          debugLog('warn', 'podcasts', `The episode would not play: ${String(caught)}`);
        });
      })();
    },
    [audio, close, local, remember]
  );

  const togglePlay = useCallback(() => {
    if (!sessionRef.current?.reporter) return;
    const element = audio();
    if (element.paused) {
      element.play().catch((caught: unknown) => {
        debugLog('warn', 'podcasts', `The episode would not play: ${String(caught)}`);
      });
    } else element.pause();
  }, [audio]);

  const pause = useCallback(() => {
    const element = audioRef.current;
    if (element && !element.paused) element.pause();
  }, []);

  const seek = useCallback(
    (seconds: number) => {
      if (!sessionRef.current?.reporter) return;
      const element = audio();
      const end = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : duration;
      const to = Math.min(end, Math.max(0, seconds));
      element.currentTime = to;
      setPosition(to);
    },
    [audio, duration]
  );

  const skip = useCallback((seconds: number) => seek(audio().currentTime + seconds), [audio, seek]);

  return { current, phase, isPlaying, position, duration, local, open, togglePlay, pause, seek, skip };
}
