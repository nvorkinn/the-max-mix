// The tablet's sound for Sonos rooms. While Sonos rooms play along with the tablet, Spotify still plays on the tablet
// (Soloist), and the Pi routes Soloist's stream to TABLET_SINK as well, a sink of its own PipeWire config
// (50-kiosk-raop.conf). This serves what that sink plays as one endless FLAC stream (flac.ts) on the home network, at
// STREAM_PATH on SONOS_STREAM_PORT, for the room that leads the Sonos group; Sonos keeps the group's other rooms in time
// with it. One pw-record reads the sink while any speaker listens. When nothing plays (the tablet paused), silence is
// sent in real time, so the speaker keeps the stream open and plays again as soon as the tablet does.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { BLOCK, CHANNELS, FRAME_BYTES, flacFrame, flacHeader, RATE } from './flac.ts';

/** The sink the tablet's sound goes to for Sonos (node.name in 50-kiosk-raop.conf). */
const TABLET_SINK = 'kiosk_sonos';
export const STREAM_PATH = '/tablet.flac';
/** The port when SONOS_STREAM_PORT is not set (kiosk-server.service sets it). */
export const DEFAULT_STREAM_PORT = 6330;
const PW_RECORD = '/usr/bin/pw-record';
/** How long one frame of audio lasts. */
const FRAME_MS = (BLOCK / RATE) * 1000;
const SILENCE = Buffer.alloc(FRAME_BYTES);

/** The stream's address for a speaker: the Pi's address on the home network, the port, the path. */
export const tabletStreamUrl = (address: string, port: number): string => `http://${address}:${port}${STREAM_PATH}`;

/** A running pw-record, as far as the stream needs one; tests pass a fake. */
export interface Recorder {
  stdout: { on: (event: 'data', listener: (chunk: Buffer) => void) => unknown };
  on: (event: 'close' | 'error', listener: () => void) => unknown;
  kill: () => unknown;
}

type StartRecorder = () => Recorder;

function recorderEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { LC_ALL: 'C' };
  const runtime = process.env['XDG_RUNTIME_DIR'];
  if (runtime) env['XDG_RUNTIME_DIR'] = runtime;
  return env;
}

/** pw-record on what TABLET_SINK plays, as raw 16-bit stereo at 44.1 kHz on its stdout. */
const startRecorder: StartRecorder = () =>
  spawn(
    PW_RECORD,
    [
      '--target',
      TABLET_SINK,
      '-P',
      '{ stream.capture.sink=true }',
      '--rate',
      String(RATE),
      '--channels',
      String(CHANNELS),
      '--format',
      's16',
      '--latency',
      '20ms',
      '-'
    ],
    { env: recorderEnvironment(), stdio: ['ignore', 'pipe', 'ignore'] }
  );

interface Listener {
  response: ServerResponse;
  frame: number;
}

/** The tablet's stream for every speaker that listens; `start` and `tick` are injectable for tests. */
export class TabletStream {
  private readonly start: StartRecorder;
  private readonly listeners = new Set<Listener>();
  private recorder: Recorder | null = null;
  private pending = Buffer.alloc(0);
  private heard = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(start: StartRecorder = startRecorder) {
    this.start = start;
  }

  /** Sends one frame of audio to every listener. */
  private send(pcm: Buffer): void {
    for (const listener of this.listeners) {
      listener.response.write(flacFrame(pcm, listener.frame));
      listener.frame += 1;
    }
  }

  /** Starts pw-record and the silence clock, unless they run. */
  private run(): void {
    if (this.recorder) return;
    const recorder = this.start();
    this.recorder = recorder;
    recorder.stdout.on('data', chunk => {
      this.heard = true;
      this.pending = Buffer.concat([this.pending, chunk]);
      while (this.pending.length >= FRAME_BYTES) {
        this.send(this.pending.subarray(0, FRAME_BYTES));
        this.pending = this.pending.subarray(FRAME_BYTES);
      }
    });
    const ended = () => {
      if (this.recorder !== recorder) return;
      this.recorder = null;
      // pw-record went away (PipeWire restarted): a new one, while speakers still listen.
      if (this.listeners.size === 0) return;
      setTimeout(() => {
        this.run();
      }, FRAME_MS * 10);
    };
    recorder.on('close', ended);
    recorder.on('error', ended);
    this.timer ??= setInterval(() => {
      this.tick();
    }, FRAME_MS);
  }

  private stop(): void {
    const { recorder } = this;
    this.recorder = null;
    recorder?.kill();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pending = Buffer.alloc(0);
  }

  /** How many speakers listen now. */
  get count(): number {
    return this.listeners.size;
  }

  /** Answers GET or HEAD of STREAM_PATH; anything else is 404. */
  handle(request: IncomingMessage, response: ServerResponse): void {
    const path = (request.url ?? '').split('?', 1)[0];
    if (path !== STREAM_PATH || (request.method !== 'GET' && request.method !== 'HEAD')) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'audio/flac', 'Cache-Control': 'no-cache', Connection: 'close' });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    response.write(flacHeader());
    const listener: Listener = { response, frame: 0 };
    this.listeners.add(listener);
    console.info(`tablet stream: ${request.socket.remoteAddress ?? 'a speaker'} listens (${this.listeners.size})`);
    request.socket.on('close', () => {
      this.listeners.delete(listener);
      console.info(`tablet stream: ${request.socket.remoteAddress ?? 'a speaker'} left (${this.listeners.size})`);
      if (this.listeners.size === 0) this.stop();
    });
    this.run();
  }

  /** Once a frame's time: when pw-record gave nothing since the last one, a frame of silence keeps the stream going. */
  tick(): void {
    if (!this.heard && this.listeners.size > 0) this.send(SILENCE);
    this.heard = false;
  }
}

/** Serves the tablet's stream on `port`, on every address (the speakers are on the home network). */
export function serveTabletStream(port: number, stream = new TabletStream()): Server {
  const server = createServer((request, response) => {
    stream.handle(request, response);
  });
  server.listen(port, '0.0.0.0');
  return server;
}
