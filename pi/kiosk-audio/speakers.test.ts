// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dump, silence } from './fixtures.ts';
import { parseDump } from './pipewire.ts';
import type { Plan } from './pipewire.ts';
import { loadSpeakers, parseLink, route, saveSpeakers, validSpeakers } from './speakers.ts';
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

const tooMany = new URL('kiosk-audio://route');
for (let index = 0; index < 17; index++) tooMany.searchParams.append('speaker', String(index));

describe('parseLink', () => {
  it('reads the speakers of a route link', () => {
    expect(parseLink('kiosk-audio://route?speaker=Kitchen&speaker=Living%20Room&speaker=Kitchen')).toEqual([
      'Kitchen',
      'Living Room'
    ]);
    expect(parseLink('kiosk-audio:route?speaker=Kitchen')).toEqual(['Kitchen']);
  });

  it('reads a route link without speakers as the default output', () => {
    expect(parseLink('kiosk-audio://route')).toEqual([]);
    expect(parseLink('kiosk-audio://route/')).toEqual([]);
  });

  it('refuses anything else', () => {
    for (const link of [
      'not a url',
      'https://route?speaker=Kitchen',
      'kiosk-audio://other?speaker=Kitchen',
      'kiosk-audio://route?speaker=',
      tooMany.href
    ]) {
      expect(parseLink(link)).toBeNull();
    }
  });
});

describe('validSpeakers', () => {
  it('accepts only a short list of short names', () => {
    expect(validSpeakers(['a', 'a'])).toEqual(['a']);
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
