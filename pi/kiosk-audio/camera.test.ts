import { afterEach, describe, expect, it, vi } from 'vitest';
import { Camera, FrameSplitter, hasCamera, STREAM_COMMAND } from './camera.ts';
import type { CameraProcess, Viewer } from './camera.ts';
import type { Result, Run } from './nmcli.ts';

// rpicam-hello --list-cameras on the-max-mix-max (Pi 5, Waveshare RPI-HMI-101D) on 2026-11-26.
const LISTED = `Available cameras
-----------------
0 : ov5647 [2592x1944 10-bit GBRG] (/base/axi/pcie@1000120000/rp1/i2c@80000/ov5647@36)
    Modes: 'SGBRG10_CSI2P' : 640x480 [62.50 fps - (16, 0)/2560x1920 crop]
                             1296x972 [46.34 fps - (0, 0)/2592x1944 crop]
`;

const jpeg = (...body: number[]) => Buffer.from([0xff, 0xd8, ...body, 0xff, 0xd9]);

const answers =
  (result: Partial<Result>): Run =>
  () =>
    Promise.resolve({ code: 0, stdout: '', stderr: '', ...result });

/** Stands in for rpicam-vid: the test sends what it would write, and ends it. */
function fakeProcess() {
  const onData: ((chunk: Buffer) => void)[] = [];
  const onEnd: Record<'close' | 'error', (() => void)[]> = { close: [], error: [] };
  const emit = (event: 'close' | 'error') => {
    const listeners = onEnd[event];
    for (const listener of listeners) listener();
  };
  const kill = vi.fn(() => {
    emit('close');
  });
  const process: CameraProcess = {
    stdout: {
      on: (_event, listener) => {
        onData.push(listener);
      }
    },
    on: (event, listener) => {
      onEnd[event].push(listener);
    },
    kill
  };
  const write = (chunk: Buffer) => {
    for (const listener of onData) listener(chunk);
  };
  return {
    process,
    kill,
    write,
    fail: () => {
      emit('error');
    }
  };
}

function viewer() {
  const frames: Buffer[] = [];
  const end = vi.fn();
  const watching: Viewer = {
    frame: frame => {
      frames.push(frame);
    },
    end
  };
  return { watching, frames, end };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('hasCamera', () => {
  it('finds the camera in the list', () => {
    expect(hasCamera(LISTED)).toBe(true);
  });

  it('finds none when there is none', () => {
    expect(hasCamera('No cameras available!\n')).toBe(false);
    expect(hasCamera('')).toBe(false);
  });
});

describe('FrameSplitter', () => {
  it('cuts frames that arrive whole, in pieces and several at once', () => {
    const splitter = new FrameSplitter();
    const first = jpeg(1, 2, 3);
    const second = jpeg(4);
    expect(splitter.push(first)).toEqual([first]);
    expect(splitter.push(first.subarray(0, 3))).toEqual([]);
    const restAndMore = Buffer.concat([first.subarray(3), second, second.subarray(0, 1)]);
    expect(splitter.push(restAndMore)).toEqual([first, second]);
    expect(splitter.push(second.subarray(1))).toEqual([second]);
  });

  it('skips what is not a frame', () => {
    const splitter = new FrameSplitter();
    expect(splitter.push(Buffer.from('noise'))).toEqual([]);
    const noiseThenFrame = Buffer.concat([Buffer.from('more'), jpeg(9)]);
    expect(splitter.push(noiseThenFrame)).toEqual([jpeg(9)]);
  });
});

describe('Camera', () => {
  it('asks once whether there is a camera', async () => {
    const run = vi.fn(answers({ stdout: LISTED }));
    const camera = new Camera(run, vi.fn());
    await expect(camera.available()).resolves.toBe(true);
    await expect(camera.available()).resolves.toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0]).toEqual(['rpicam-hello', '--list-cameras']);
  });

  it('has none when the list is empty or rpicam-hello is missing', async () => {
    const empty = new Camera(answers({ stdout: 'No cameras available!\n' }), vi.fn());
    await expect(empty.available()).resolves.toBe(false);
    const missing = new Camera(answers({ code: 127, stderr: 'spawn ENOENT' }), vi.fn());
    await expect(missing.available()).resolves.toBe(false);
  });

  it('runs one rpicam-vid for everyone watching, and stops it when the last one leaves', () => {
    const { process, kill, write } = fakeProcess();
    const start = vi.fn(() => process);
    const camera = new Camera(answers({}), start);
    const first = viewer();
    const second = viewer();
    const stopFirst = camera.watch(first.watching);
    const stopSecond = camera.watch(second.watching);
    expect(start).toHaveBeenCalledExactlyOnceWith(STREAM_COMMAND);
    write(jpeg(1));
    expect(first.frames).toEqual([jpeg(1)]);
    expect(second.frames).toEqual([jpeg(1)]);
    stopFirst();
    expect(kill).not.toHaveBeenCalled();
    write(jpeg(2));
    expect(first.frames).toHaveLength(1);
    expect(second.frames).toHaveLength(2);
    stopSecond();
    expect(kill).toHaveBeenCalledOnce();
    // Whoever left by themselves is not told that the camera stopped.
    expect(second.end).not.toHaveBeenCalled();
  });

  it('starts it again for the next one to watch', () => {
    const start = vi.fn(() => fakeProcess().process);
    const camera = new Camera(answers({}), start);
    camera.watch(viewer().watching)();
    camera.watch(viewer().watching);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('turns the camera off after the longest it may stay on, and tells whoever watches', () => {
    vi.useFakeTimers();
    const { process, kill } = fakeProcess();
    const camera = new Camera(answers({}), () => process, 1000);
    const watching = viewer();
    camera.watch(watching.watching);
    vi.advanceTimersByTime(999);
    expect(kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledOnce();
    expect(watching.end).toHaveBeenCalledOnce();
  });

  it('tells whoever watches when rpicam-vid would not start', () => {
    const { process, fail } = fakeProcess();
    const camera = new Camera(answers({}), () => process);
    const watching = viewer();
    camera.watch(watching.watching);
    fail();
    expect(watching.end).toHaveBeenCalledOnce();
  });
});
