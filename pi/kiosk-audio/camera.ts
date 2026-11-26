// The camera built into the kiosk's screen, for reading a QR code held up to it (the app's Wi-Fi settings): whether
// there is one, and its picture as JPEG frames while the app shows it. A CSI camera on a Pi 5 is reached through
// libcamera only, which Chromium under Cage cannot open, so rpicam-vid reads it here and the app decodes the frames.
// It runs only while someone is watching, and never longer than MAX_WATCH_MS.
import { spawn } from 'node:child_process';
import { runCommand } from './nmcli.ts';
import type { Run } from './nmcli.ts';

const LIST_TIMEOUT_MS = 10_000;
/** The camera goes off after this long however many are watching, so it is never left on. */
export const MAX_WATCH_MS = 3 * 60_000;
/** A frame is some hundred kilobytes; more than this without the end of one is not a JPEG stream. */
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

const START_OF_IMAGE = Buffer.from([0xff, 0xd8]);
const END_OF_IMAGE = Buffer.from([0xff, 0xd9]);

/**
 * rpicam-vid's arguments. The sensor's full picture, since a code on a phone held at arm's length is small in it, and
 * darker than the camera would choose: a phone's screen is far brighter than the room, and its code washes out
 * otherwise (the-max-mix-max, 2026-11-26: none of 20 frames read as metered, 6 of 6 at -1.5).
 */
export const STREAM_COMMAND: readonly string[] = [
  'rpicam-vid',
  '--timeout',
  '0',
  '--nopreview',
  '--codec',
  'mjpeg',
  '--width',
  '2592',
  '--height',
  '1944',
  '--framerate',
  '5',
  '--ev',
  '-1.5',
  '--output',
  '-'
];

/** A running rpicam-vid, as far as the camera needs one; tests pass a fake. */
export interface CameraProcess {
  stdout: { on: (event: 'data', listener: (chunk: Buffer) => void) => unknown };
  on: (event: 'close' | 'error', listener: () => void) => unknown;
  kill: () => unknown;
}

export type Start = (argv: readonly string[]) => CameraProcess;

const COMMAND_ENV = { LC_ALL: 'C', PATH: '/usr/sbin:/usr/bin:/sbin:/bin' };

const startCommand: Start = ([file = '', ...args]) =>
  // The command is the fixed STREAM_COMMAND, found on COMMAND_ENV's PATH.
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- see above
  spawn(file, args, { env: COMMAND_ENV, stdio: ['ignore', 'pipe', 'ignore'] });

/** Whether `rpicam-hello --list-cameras` printed a camera ("0 : ov5647 [2592x1944 …]"). */
export function hasCamera(output: string): boolean {
  return output.split('\n').some(line => /^\d+ : /.test(line.trimStart()));
}

/** Cuts a stream of JPEGs, one after another, into frames. */
export class FrameSplitter {
  private pending = Buffer.alloc(0);

  /** The frames `chunk` completes, in order. */
  push(chunk: Buffer): Buffer[] {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    const frames: Buffer[] = [];
    for (;;) {
      const start = this.pending.indexOf(START_OF_IMAGE);
      if (start === -1) {
        // Keep a last 0xff, which may be the first half of a start.
        this.pending = this.pending.subarray(Math.max(0, this.pending.length - 1));
        break;
      }
      const end = this.pending.indexOf(END_OF_IMAGE, start + START_OF_IMAGE.length);
      if (end === -1) {
        this.pending = this.pending.length - start > MAX_FRAME_BYTES ? Buffer.alloc(0) : this.pending.subarray(start);
        break;
      }
      frames.push(this.pending.subarray(start, end + END_OF_IMAGE.length));
      this.pending = this.pending.subarray(end + END_OF_IMAGE.length);
    }
    return frames;
  }
}

/** Someone watching the camera: each frame as it comes, and the end when the camera stops by itself. */
export interface Viewer {
  frame: (jpeg: Buffer) => void;
  end: () => void;
}

export class Camera {
  private found: Promise<boolean> | undefined;
  private readonly viewers = new Set<Viewer>();
  private running: CameraProcess | undefined;
  private limit: NodeJS.Timeout | undefined;
  private readonly run: Run;
  private readonly start: Start;
  private readonly maxWatchMs: number;

  constructor(run: Run = runCommand, start: Start = startCommand, maxWatchMs = MAX_WATCH_MS) {
    this.run = run;
    this.start = start;
    this.maxWatchMs = maxWatchMs;
  }

  private async find(): Promise<boolean> {
    const result = await this.run(['rpicam-hello', '--list-cameras'], '', LIST_TIMEOUT_MS);
    return result.code === 0 && hasCamera(`${result.stdout}\n${result.stderr}`);
  }

  private turnOn(): void {
    const process = this.start(STREAM_COMMAND);
    const splitter = new FrameSplitter();
    this.running = process;
    process.stdout.on('data', chunk => {
      for (const frame of splitter.push(chunk)) for (const viewer of this.viewers) viewer.frame(frame);
    });
    const ended = () => {
      if (this.running !== process) return;
      this.running = undefined;
      clearTimeout(this.limit);
      const watching = [...this.viewers];
      this.viewers.clear();
      for (const viewer of watching) viewer.end();
    };
    process.on('close', ended);
    // rpicam-vid is missing or would not start.
    process.on('error', ended);
    this.limit = setTimeout(() => process.kill(), this.maxWatchMs);
  }

  private turnOff(): void {
    clearTimeout(this.limit);
    this.running?.kill();
    this.running = undefined;
  }

  /** Whether the Pi has a camera. Asked once: a camera on a ribbon cable is not plugged in while the Pi runs. */
  available(): Promise<boolean> {
    this.found ??= this.find();
    return this.found;
  }

  /** Turns the camera on for `viewer`, if it is not on already; the function returned stops their watching. */
  watch(viewer: Viewer): () => void {
    this.viewers.add(viewer);
    if (!this.running) this.turnOn();
    return () => {
      this.viewers.delete(viewer);
      if (this.viewers.size === 0) this.turnOff();
    };
  }
}
