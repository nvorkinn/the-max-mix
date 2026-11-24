// @vitest-environment node
/* eslint-disable unicorn/prefer-event-target -- A child process is an EventEmitter, so the stand-in is one. */
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSoloistKey, SoloistPlayer, soloistDeviceName, validSoloistRequest } from './soloist.ts';
import type { FetchKey, KeyResult, SoloistRequest } from './soloist.ts';

const REQUEST: SoloistRequest = { person: 'nikolai', server: 'https://api.countdown.build', secret: 'device-secret' };

/** Stands in for a running Soloist: it exits when killed, or when a test says so. */
class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  readonly signals: string[] = [];
  kill(signal: string): boolean {
    this.signals.push(signal);
    this.end(null);
    return true;
  }
  end(code: number | null): void {
    if (this.exitCode !== null) return;
    this.exitCode = code ?? 0;
    this.emit('exit', code);
  }
}

const KEYS: Record<string, KeyResult> = { nikolai: { key: 'key-n' }, ola: { key: 'key-o' } };
const stateDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(stateDirs.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});

async function player() {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'soloist-'));
  stateDirs.push(stateDir);
  const children: FakeChild[] = [];
  const runs: string[][] = [];
  const fetchKey = vi.fn<FetchKey>(request => Promise.resolve(KEYS[request.person] ?? { error: 'no-key' }));
  const soloist = new SoloistPlayer({
    stateDir,
    deviceName: 'The Max Mix 4',
    fetchKey,
    restartMs: 5,
    log: () => {
      // Quiet in tests.
    },
    spawn: args => {
      runs.push(args);
      const child = new FakeChild();
      children.push(child);
      return child as unknown as ChildProcess;
    }
  });
  return { soloist, children, runs, fetchKey, stateDir };
}

const argument = (args: string[] | undefined, flag: string) => args?.[args.indexOf(flag) + 1];

describe('validSoloistRequest', () => {
  it('takes a Spotify ID, an https server and a secret', () => {
    expect(validSoloistRequest({ ...REQUEST, server: 'https://api.countdown.build/some/path' })).toEqual(REQUEST);
  });

  it('refuses anything else', () => {
    for (const person of ['', '../x', '.hidden', 'a/b', 'with space', 'x'.repeat(129), 7]) {
      expect(validSoloistRequest({ ...REQUEST, person })).toBeNull();
    }
    // eslint-disable-next-line sonarjs/no-clear-text-protocols, unicorn/prefer-https -- plain http is what it refuses
    expect(validSoloistRequest({ ...REQUEST, server: 'http://api.countdown.build' })).toBeNull();
    expect(validSoloistRequest({ ...REQUEST, server: 'not a url' })).toBeNull();
    expect(validSoloistRequest({ ...REQUEST, secret: 'has space' })).toBeNull();
    expect(validSoloistRequest(null)).toBeNull();
  });
});

describe('soloistDeviceName', () => {
  it('takes the kiosk’s configured name first', () => {
    expect(soloistDeviceName('Kitchen', 'the-max-mix-4')).toBe('Kitchen');
    expect(soloistDeviceName('  Living room \n', 'the-max-mix-1')).toBe('Living room');
  });

  it('names the kiosk after its host name otherwise', () => {
    expect(soloistDeviceName(undefined, 'the-max-mix-4')).toBe('The Max Mix 4');
    expect(soloistDeviceName('', 'the-max-mix-1')).toBe('The Max Mix 1');
    expect(soloistDeviceName(' '.repeat(3), 'The-Max-Mix-12')).toBe('The Max Mix 12');
    expect(soloistDeviceName(undefined, 'the-max-mix')).toBe('The Max Mix');
  });

  it('keeps a host name that is not the-max-mix-<n> whole, in brackets', () => {
    expect(soloistDeviceName(undefined, 'living-room')).toBe('The Max Mix (living-room)');
    expect(soloistDeviceName(undefined, 'kitchen-pi')).toBe('The Max Mix (kitchen-pi)');
    expect(soloistDeviceName(undefined, '')).toBe('The Max Mix');
  });

  it('keeps a long name within what Spotify shows', () => {
    expect(soloistDeviceName('x'.repeat(100), 'the-max-mix-4')).toHaveLength(64);
  });
});

describe('SoloistPlayer', () => {
  it("runs Soloist with the person's key and their own data folder", async () => {
    const { soloist, runs, fetchKey, stateDir } = await player();
    expect(await soloist.play(REQUEST)).toBe('playing');
    expect(fetchKey).toHaveBeenCalledWith(REQUEST);
    expect(argument(runs[0], '--api-key')).toBe('key-n');
    expect(argument(runs[0], '--ws')).toBe('127.0.0.1:7342');
    expect(argument(runs[0], '--device-name')).toBe('The Max Mix 4');
    const dataDir = argument(runs[0], '--data-dir') ?? '';
    expect(dataDir).toBe(path.join(stateDir, 'people', 'nikolai'));
    expect((await stat(dataDir)).mode & 0o777).toBe(0o700);
  });

  it('changes nothing when asked for the same person again', async () => {
    const { soloist, runs } = await player();
    await soloist.play(REQUEST);
    expect(await soloist.play({ ...REQUEST })).toBe('playing');
    expect(runs).toHaveLength(1);
  });

  it('stops one person’s Soloist before starting the next one’s', async () => {
    const { soloist, runs, children, stateDir } = await player();
    await soloist.play(REQUEST);
    await soloist.play({ ...REQUEST, person: 'ola' });
    expect(children[0]?.signals).toEqual(['SIGTERM']);
    expect(argument(runs[1], '--api-key')).toBe('key-o');
    expect(argument(runs[1], '--data-dir')).toBe(path.join(stateDir, 'people', 'ola'));
  });

  it('starts nothing for someone with no key', async () => {
    const { soloist, runs } = await player();
    expect(await soloist.play({ ...REQUEST, person: 'nobody' })).toBe('no-key');
    expect(runs).toEqual([]);
  });

  it('starts Soloist again, with a fresh key, when it stops by itself', async () => {
    const { soloist, runs, children, fetchKey } = await player();
    await soloist.play(REQUEST);
    children[0]?.end(1);
    expect(soloist.state).toBe('failed');
    await vi.waitFor(() => {
      expect(runs).toHaveLength(2);
    });
    expect(fetchKey).toHaveBeenCalledTimes(2);
    expect(soloist.state).toBe('playing');
  });

  it('waits for a new build when this one has expired', async () => {
    const { soloist, runs, children } = await player();
    await soloist.play(REQUEST);
    children[0]?.end(10);
    expect(soloist.state).toBe('expired');
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(runs).toHaveLength(1);
    await soloist.stop();
  });

  it('stops', async () => {
    const { soloist, children, runs } = await player();
    await soloist.play(REQUEST);
    await soloist.stop();
    expect(children[0]?.signals).toEqual(['SIGTERM']);
    expect(soloist.state).toBe('stopped');
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(runs).toHaveLength(1);
  });
});

describe('fetchSoloistKey', () => {
  it("asks countdown-server for the person's key with the device secret", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(Response.json({ api_key: 'key-n' })));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchSoloistKey(REQUEST)).toEqual({ key: 'key-n' });
    const [url = '', init] = fetch.mock.calls[0] ?? [];
    expect(new Request(url).url).toBe('https://api.countdown.build/api/devices/soloist/key?person=nikolai');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer device-secret');
  });

  it('says why there is no key', async () => {
    const answers: [number, KeyResult][] = [
      [404, { error: 'no-key' }],
      [409, { error: 'not-paired' }],
      [401, { error: 'unknown-device' }],
      [500, { error: 'failed' }]
    ];
    for (const [status, result] of answers) {
      vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status })));
      // Each answer is checked on its own.
      // eslint-disable-next-line no-await-in-loop
      expect(await fetchSoloistKey(REQUEST)).toEqual(result);
    }
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    expect(await fetchSoloistKey(REQUEST)).toEqual({ error: 'failed' });
  });
});
