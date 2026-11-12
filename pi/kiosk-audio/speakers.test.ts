// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dump, link, silence } from './fixtures.ts';
import { parseDump } from './pipewire.ts';
import type { Plan } from './pipewire.ts';
import {
  loadSpeakers,
  route,
  saveSpeakers,
  setSpeakerVolume,
  speakerOutputs,
  validChoices,
  validVolume,
  withNames
} from './speakers.ts';
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

/** A connected Bluetooth speaker's sink, as PipeWire's Bluetooth plugin makes it. */
const bluetoothSink = (props: Record<string, unknown> = { 'api.bluez5.address': '00:11:22:aa:bb:cc' }) => ({
  id: 100,
  type: 'PipeWire:Interface:Node',
  info: {
    props: {
      'node.name': 'bluez_output.00_11_22_AA_BB_CC.1',
      'media.class': 'Audio/Sink',
      'node.description': 'Boom',
      ...props
    }
  }
});

describe('validChoices', () => {
  it('takes output ids, or else speaker names', () => {
    expect(validChoices({ outputs: ['raop_sink.a', 'raop_sink.a'] })).toEqual([{ id: 'raop_sink.a' }]);
    expect(validChoices({ speakers: ['a', 'a'] })).toEqual([{ name: 'a' }]);
    expect(validChoices({ outputs: [] })).toEqual([]);
    expect(validChoices({ speakers: [] })).toEqual([]);
  });

  it('accepts only a short list of short strings', () => {
    expect(validChoices({ speakers: Array.from({ length: 17 }, (_, index) => String(index)) })).toBeNull();
    for (const bad of ['a', [1], [''], ['x'.repeat(300)], null]) {
      expect(validChoices({ speakers: bad })).toBeNull();
      expect(validChoices({ outputs: bad })).toBeNull();
    }
    expect(validChoices(null)).toBeNull();
  });
});

describe('speakerOutputs', () => {
  it('reports each speaker sink by id, with its kind, volume and whether the browser plays to it', () => {
    const graph = parseDump(dump([bluetoothSink()], [link(83, 71, 51), link(84, 72, 52)]));
    expect(speakerOutputs(graph)).toEqual([
      {
        id: 'bluez_output.00_11_22_AA_BB_CC.1',
        name: 'Boom',
        kind: 'bluetooth',
        address: '00:11:22:AA:BB:CC',
        volume: null,
        linked: false
      },
      { id: 'raop_sink.Kitchen.local.7000', name: 'Kitchen', kind: 'airplay', volume: 40, linked: true },
      { id: 'raop_sink.Lounge.local.7000', name: 'Lounge', kind: 'airplay', volume: null, linked: false }
    ]);
  });

  it('leaves the address out when PipeWire gives none', () => {
    const [output] = speakerOutputs(parseDump(dump([bluetoothSink({})])));
    expect(output).toEqual({
      id: 'bluez_output.00_11_22_AA_BB_CC.1',
      name: 'Boom',
      kind: 'bluetooth',
      volume: null,
      linked: false
    });
  });
});

describe('withNames', () => {
  it('adds the name of each output that is there', () => {
    const graph = parseDump(dump());
    expect(
      withNames(graph, [{ id: 'raop_sink.Kitchen.local.7000' }, { id: 'raop_sink.Gone' }, { name: 'Lounge' }])
    ).toEqual([{ id: 'raop_sink.Kitchen.local.7000', name: 'Kitchen' }, { id: 'raop_sink.Gone' }, { name: 'Lounge' }]);
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
    const choices = [{ id: 'raop_sink.Kitchen.local.7000', name: 'Kitchen' }, { name: 'Lounge' }];
    await saveSpeakers(file, choices);
    await expect(loadSpeakers(file)).resolves.toEqual(choices);
  });

  it('are read from a file saved before outputs had ids', async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ speakers: ['Kitchen'] }));
    await expect(loadSpeakers(file)).resolves.toEqual([{ name: 'Kitchen' }]);
  });

  it('are none when the file is missing or broken', async () => {
    await expect(loadSpeakers(file)).resolves.toEqual([]);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '[1, 2]');
    await expect(loadSpeakers(file)).resolves.toEqual([]);
    await writeFile(file, JSON.stringify({ choices: [{ id: 'raop_sink.a' }, {}] }));
    await expect(loadSpeakers(file)).resolves.toEqual([]);
  });
});

describe('route', () => {
  it('applies what is needed, and nothing when nothing is', async () => {
    silence('info');
    const fake = new FakePipeWire();
    const plan = await route(fake, [{ name: 'Kitchen' }]);
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
  it('accepts one output id or speaker name and a whole percentage', () => {
    const id = 'raop_sink.Kitchen.local.7000';
    expect(validVolume({ output: id, volume: 0 })).toEqual({ target: { id }, volume: 0 });
    expect(validVolume({ speaker: 'Kitchen', volume: 0 })).toEqual({ target: { name: 'Kitchen' }, volume: 0 });
    expect(validVolume({ speaker: 'Kitchen', volume: 100 })).toEqual({ target: { name: 'Kitchen' }, volume: 100 });
    for (const bad of [
      { speaker: 'Kitchen', volume: -1 },
      { speaker: 'Kitchen', volume: '5' },
      { speaker: '', volume: 5 },
      { output: '', volume: 5 },
      []
    ]) {
      expect(validVolume(bad)).toBeNull();
    }
  });

  it('sets the speaker sink with that id or name, and says when there is none', async () => {
    const set: [number, number][] = [];
    const fake = {
      graph: () => Promise.resolve(parseDump(dump())),
      setVolume: (node: number, volume: number) => {
        set.push([node, volume]);
        return Promise.resolve();
      }
    };
    await expect(setSpeakerVolume(fake, { name: 'Kitchen' }, 25)).resolves.toBe(1);
    await expect(setSpeakerVolume(fake, { id: 'raop_sink.Lounge.local.7000' }, 30)).resolves.toBe(1);
    // The Pi's own output is not a speaker, by name or by id.
    await expect(setSpeakerVolume(fake, { name: 'Built-in Audio' }, 25)).resolves.toBe(0);
    await expect(setSpeakerVolume(fake, { id: 'alsa_output.hdmi' }, 25)).resolves.toBe(0);
    expect(set).toEqual([
      [50, 0.25],
      [60, 0.3]
    ]);
  });
});
