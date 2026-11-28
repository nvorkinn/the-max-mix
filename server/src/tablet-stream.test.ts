// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRAME_BYTES, flacHeader } from './flac.ts';
import { serveTabletStream, STREAM_PATH, TabletStream, tabletStreamUrl } from './tablet-stream.ts';
import type { Recorder } from './tablet-stream.ts';

class FakeRecorder extends EventEmitter implements Recorder {
  readonly stdout = new EventEmitter();
  killed = false;
  kill() {
    this.killed = true;
    this.emit('close');
  }
}

const servers: { close: () => void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  vi.restoreAllMocks();
});

async function serve(stream: TabletStream): Promise<string> {
  const server = serveTabletStream(0, stream);
  servers.push(server);
  await new Promise(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Reads from the response until it holds at least `bytes`. */
async function readAtLeast(reader: ReadableStreamDefaultReader<Uint8Array>, bytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  while (size < bytes) {
    // eslint-disable-next-line no-await-in-loop
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    size += value.length;
  }
  return Buffer.concat(chunks);
}

describe('the tablet stream', () => {
  it('says where the speakers find it', () => {
    expect(tabletStreamUrl('192.0.2.7', 6330)).toBe('http://192.0.2.7:6330/tablet.flac');
  });

  it('sends FLAC frames of what pw-record reads, and silence while it reads nothing', async () => {
    vi.spyOn(console, 'info').mockReturnValue();
    const recorder = new FakeRecorder();
    const start = vi.fn(() => recorder);
    const stream = new TabletStream(start);
    const base = await serve(stream);
    expect((await fetch(`${base}/other`)).status).toBe(404);

    const controller = new AbortController();
    const response = await fetch(`${base}${STREAM_PATH}`, { signal: controller.signal });
    expect(response.headers.get('content-type')).toBe('audio/flac');
    if (!response.body) throw new Error('no body');
    const reader = response.body.getReader();
    const header = await readAtLeast(reader, flacHeader().length);
    expect(header.subarray(0, 4).toString()).toBe('fLaC');
    await vi.waitFor(() => {
      expect(stream.count).toBe(1);
    });

    const sound = Buffer.alloc(FRAME_BYTES, 1);
    recorder.stdout.emit('data', sound.subarray(0, 100));
    recorder.stdout.emit('data', sound.subarray(100));
    const first = await readAtLeast(reader, FRAME_BYTES);
    expect(first.length).toBeGreaterThanOrEqual(FRAME_BYTES);
    // A tick after sound sends nothing; the next one, with nothing heard, sends a frame of silence.
    stream.tick();
    stream.tick();
    const silent = await readAtLeast(reader, FRAME_BYTES);
    expect(silent.length).toBeGreaterThanOrEqual(FRAME_BYTES);
    expect(start).toHaveBeenCalledTimes(1);

    controller.abort();
    await vi.waitFor(() => {
      expect(recorder.killed).toBe(true);
    });
    expect(stream.count).toBe(0);
  });
});
