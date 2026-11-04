// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dump, silence } from './fixtures.ts';
import { parseDump } from './pipewire.ts';
import type { Plan } from './pipewire.ts';
import { loadSpeakers, route, saveSpeakers, setSpeakerVolume, validSpeakers, validVolume } from './speakers.ts';
import type { AudioGraph } from './speakers.ts';

class FakePipeWire implements AudioGraph {
  applied: Plan[] = [];

  graph() {
    return Promise.resolve(parseDump(dump()));
  }

  apply(plan: Plan) {
    this.applied.push(plan);
    return Promise.resolve(true);
  }
}

describe('validSpeakers', () => {
  it('accepts only a short list of short names', () => {
    expect(validSpeakers(['a', 'a'])).toEqual(['a']);
    expect(validSpeakers([])).toEqual([]);
    expect(validSpeakers(Array.from({ length: 17 }, (_, index) => String(index)))).toBeNull();
    for (const bad of ['a', [1], [''], ['x'.repeat(300)], null]) expect(validSpeakers(bad)).toBeNull();
  });
});

describe('the saved speakers', () => {
  let directory: string;
  let file: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'kiosk-audio-'));
    file = path.join(directory, 'state', 'speakers.json');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('are read back as saved', async () => {
    await saveSpeakers(file, ['Kitchen']);
    await expect(loadSpeakers(file)).resolves.toEqual(['Kitchen']);
  });

  it('are none when the file is missing or broken', async () => {
    await expect(loadSpeakers(file)).resolves.toEqual([]);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '[1, 2]');
    await expect(loadSpeakers(file)).resolves.toEqual([]);
  });
});

describe('route', () => {
  it('applies what is needed, and nothing when nothing is', async () => {
    silence('info');
    const fake = new FakePipeWire();
    const plan = await route(fake, ['Kitchen']);
    expect(plan.connect).toEqual([
      [71, 51],
      [72, 52]
    ]);
    expect(fake.applied).toEqual([plan]);
    await route(fake, []); // Chromium already plays to the default output
    expect(fake.applied).toHaveLength(1);
  });
});

describe('volume', () => {
  it('accepts one speaker name and a whole percentage', () => {
    expect(validVolume({ speaker: 'Kitchen', volume: 0 })).toEqual({ speaker: 'Kitchen', volume: 0 });
    expect(validVolume({ speaker: 'Kitchen', volume: 100 })).toEqual({ speaker: 'Kitchen', volume: 100 });
    for (const bad of [
      { speaker: 'Kitchen', volume: -1 },
      { speaker: 'Kitchen', volume: '5' },
      { speaker: '', volume: 5 },
      []
    ]) {
      expect(validVolume(bad)).toBeNull();
    }
  });

  it('sets the AirPlay sink with that name, and says when there is none', async () => {
    const set: [number, number][] = [];
    const fake = {
      graph: () => Promise.resolve(parseDump(dump())),
      setVolume: (node: number, volume: number) => {
        set.push([node, volume]);
        return Promise.resolve();
      }
    };
    await expect(setSpeakerVolume(fake, 'Kitchen', 25)).resolves.toBe(true);
    // The Pi's own output is not an AirPlay speaker, even by name.
    await expect(setSpeakerVolume(fake, 'Built-in Audio', 25)).resolves.toBe(false);
    expect(set).toEqual([[50, 0.25]]);
  });
});
