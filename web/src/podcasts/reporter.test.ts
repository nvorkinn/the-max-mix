import { describe, expect, it, vi } from 'vitest';
import { ProgressReporter } from './reporter';
import type { Timers } from './reporter';

/** Timers moved by hand: `run(ms)` fires every timer due within the next `ms`. */
function manualTimers() {
  let now = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  let next = 1;
  const timers: Timers = {
    setTimeout: (callback, ms) => {
      pending.set(next, { at: now + ms, callback });
      return next++;
    },
    clearTimeout: handle => {
      pending.delete(handle as number);
    }
  };
  const run = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...pending].filter(([, timer]) => timer.at <= end).toSorted((a, b) => a[1].at - b[1].at);
      const [first] = due;
      if (!first) break;
      pending.delete(first[0]);
      now = first[1].at;
      first[1].callback();
    }
    now = end;
  };
  return { timers, run, clock: () => now };
}

const CADENCE = { first_after_s: 5, every_s: 30 };

function reporter(startS = 100) {
  const { timers, run, clock } = manualTimers();
  let position = startS;
  const send = vi.fn<(positionS: number) => void>();
  // The position moves with the clock while it plays.
  let playingSince: number | null = null;
  const at = () => (playingSince === null ? position : position + (clock() - playingSince) / 1000);
  const subject = new ProgressReporter(CADENCE, at, send, startS, timers);
  return {
    subject,
    send,
    run,
    play: () => {
      playingSince = clock();
      subject.playing();
    },
    stop: () => {
      position = at();
      playingSince = null;
      subject.stopped();
    },
    seek: (to: number, isPlaying: boolean) => {
      position = to;
      playingSince = isPlaying ? clock() : null;
      subject.seeked(isPlaying);
    }
  };
}

describe('ProgressReporter', () => {
  it('reports first after first_after_s, then every every_s while playing', () => {
    const { send, run, play } = reporter();
    play();
    run(4999);
    expect(send).not.toHaveBeenCalled();
    run(1);
    expect(send).toHaveBeenLastCalledWith(105);
    run(30_000);
    expect(send).toHaveBeenLastCalledWith(135);
    run(30_000);
    expect(send.mock.calls).toEqual([[105], [135], [165]]);
  });

  it('reports at once on a pause, and nothing more until it plays again', () => {
    const { send, run, play, stop } = reporter();
    play();
    run(2000);
    stop();
    expect(send).toHaveBeenLastCalledWith(102);
    run(60_000);
    expect(send).toHaveBeenCalledTimes(1);
    // Playing on after a report waits every_s, not first_after_s.
    play();
    run(29_999);
    expect(send).toHaveBeenCalledTimes(1);
    run(1);
    expect(send).toHaveBeenLastCalledWith(132);
  });

  it('reports at the end of a seek, and goes on from there while it plays', () => {
    const { send, run, play, seek } = reporter();
    play();
    seek(600, true);
    expect(send).toHaveBeenLastCalledWith(600);
    run(30_000);
    expect(send).toHaveBeenLastCalledWith(630);
  });

  it('waits first_after_s after the seek that opens the episode where NRK has it', () => {
    const { send, run, play, seek } = reporter();
    seek(100, false);
    play();
    run(5000);
    expect(send.mock.calls).toEqual([[105]]);
  });

  it('does not report the position NRK already has, or the same one twice', () => {
    const { send, seek, stop } = reporter();
    // Opening the episode seeks to where it was left.
    seek(100, false);
    stop();
    expect(send).not.toHaveBeenCalled();
    seek(200, false);
    stop();
    expect(send.mock.calls).toEqual([[200]]);
  });

  it('keeps its timer through a stall in buffering, and sends nothing once disposed', () => {
    const { subject, send, run, play } = reporter();
    play();
    run(3000);
    // `playing` again after buffering does not start the wait over.
    subject.playing();
    run(2000);
    expect(send).toHaveBeenCalledTimes(1);
    subject.dispose();
    run(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
