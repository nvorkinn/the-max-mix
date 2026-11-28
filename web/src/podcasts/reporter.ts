// When the kiosk tells NRK where it is in an episode (putPodcastProgress), at NRK's own cadence (PodcastPlayback's
// `report`): first `first_after_s` after playback starts, then every `every_s` while it plays, and at once on a pause,
// at the end of a seek and at the episode's end. A position already sent is not sent again.

import type { PodcastPlayback } from 'countdown-api';

export interface Timers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const WINDOW_TIMERS: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
};

export class ProgressReporter {
  private readonly cadence: PodcastPlayback['report'];
  private readonly position: () => number;
  private readonly send: (positionS: number) => void;
  private readonly timers: Timers;
  private timer: unknown = null;
  private hasReported = false;
  private last: number;

  /**
   * `position` reads where playback is, in seconds; `send` is given each whole second to report. `startS` is where
   * playback started from, which NRK already has.
   */
  constructor(
    cadence: PodcastPlayback['report'],
    position: () => number,
    send: (positionS: number) => void,
    startS: number,
    timers: Timers = WINDOW_TIMERS
  ) {
    this.cadence = cadence;
    this.position = position;
    this.send = send;
    this.timers = timers;
    this.last = Math.floor(startS);
  }

  private schedule(seconds: number): void {
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = null;
        this.flush();
        this.schedule(this.cadence.every_s);
      },
      Math.max(1, seconds) * 1000
    );
  }

  private cancel(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private flush(): void {
    const now = Math.floor(this.position());
    // Nothing new to say (opening the episode seeks to where NRK has it) is not a report.
    if (now === this.last) return;
    this.hasReported = true;
    this.last = now;
    this.send(now);
  }

  /** Playback started, or went on after buffering. */
  playing(): void {
    if (this.timer !== null) return;
    this.schedule(this.hasReported ? this.cadence.every_s : this.cadence.first_after_s);
  }

  /** Playback paused or ended. */
  stopped(): void {
    this.cancel();
    this.flush();
  }

  /** A seek ended; `isPlaying` while it plays on. */
  seeked(isPlaying: boolean): void {
    this.cancel();
    this.flush();
    if (isPlaying) this.schedule(this.cadence.every_s);
  }

  /** The episode is closed: nothing more is sent. */
  dispose(): void {
    this.cancel();
  }
}
