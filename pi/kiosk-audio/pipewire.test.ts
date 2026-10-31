// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { dump, link, silence } from './fixtures.ts';
import {
  isEmptyPlan,
  pairPorts,
  parseDump,
  PipeWire,
  PipeWireError,
  planRoutes,
  playersOf,
  PW_DUMP,
  PW_LINK,
  runCommand
} from './pipewire.ts';
import type { Node, Port, Run } from './pipewire.ts';

const GRAPH = parseDump(dump());

function nodeAt(id: number): Node {
  const node = GRAPH.nodes.find(candidate => candidate.id === id);
  if (!node) throw new Error(`no node ${id}`);
  return node;
}

const port = (id: number, direction: Port['direction'], channel: string): Port => ({
  id,
  node: 1,
  direction,
  channel,
  isMonitor: false
});

/** Stands in for running pw-dump and pw-link: replies by program, and records every call. */
const stub = (replies: Record<string, { code: number; stderr?: string; stdout?: string }> = {}) =>
  vi.fn<Run>(([file = '']) => {
    const reply = replies[file] ?? { code: 0 };
    return Promise.resolve({ code: reply.code, stdout: reply.stdout ?? '', stderr: reply.stderr ?? '' });
  });

const planWith = (links: unknown[], speakers: string[]) => planRoutes(parseDump(dump([], links)), speakers);

describe('parseDump', () => {
  it('reads the players and the default sink', () => {
    expect(playersOf(GRAPH).map(node => node.id)).toEqual([70]);
    expect(GRAPH.defaultSink).toBe('alsa_output.hdmi');
    expect(GRAPH.links).toHaveLength(3);
  });

  it('reads a default sink given as a JSON string', () => {
    const meta = {
      id: 31,
      type: 'PipeWire:Interface:Metadata',
      props: { 'metadata.name': 'default' },
      metadata: [{ key: 'default.audio.sink', value: '{"name": "other"}' }]
    };
    expect(parseDump(dump([meta])).defaultSink).toBe('other');
  });

  it('rejects what is not a dump', () => {
    expect(() => parseDump('nope')).toThrow(PipeWireError);
    expect(() => parseDump('{}')).toThrow(PipeWireError);
  });

  it("keeps each node's description, the name Chromium shows for it", () => {
    expect(nodeAt(50).description).toBe('Kitchen');
    expect(nodeAt(40).description).toBe('Built-in Audio');
  });

  it('only counts browser streams as players', () => {
    const mpv = {
      id: 100,
      type: 'PipeWire:Interface:Node',
      info: { props: { 'node.name': 'mpv', 'media.class': 'Stream/Output/Audio', 'application.name': 'mpv' } }
    };
    const players = playersOf(parseDump(dump([mpv])));
    expect(players.map(node => node.id)).toEqual([70]);
  });
});

describe('planRoutes', () => {
  it('routes to every chosen speaker, by description, and off the local output', () => {
    const plan = planRoutes(GRAPH, ['Kitchen', 'Lounge']);
    expect(plan.connect).toEqual([
      [71, 51],
      [71, 61],
      [72, 52],
      [72, 62]
    ]);
    // The level meter's link (82) is not to a sink, so it stays.
    expect(plan.disconnect).toEqual([80, 81]);
  });

  it('has nothing to do once routed', () => {
    const plan = planWith([link(83, 71, 51), link(84, 72, 52)], ['Kitchen']);
    expect(isEmptyPlan(plan)).toBe(true);
  });

  it('drops a speaker that is no longer chosen', () => {
    const plan = planWith([link(83, 71, 51), link(84, 72, 52), link(85, 71, 61), link(86, 72, 62)], ['Lounge']);
    expect(plan).toEqual({ connect: [], disconnect: [83, 84] });
  });

  it('hands back to the default output with no speakers', () => {
    const plan = planWith([link(83, 71, 51), link(84, 72, 52)], []);
    expect(plan).toEqual({
      connect: [
        [71, 41],
        [72, 42]
      ],
      disconnect: [83, 84]
    });
  });

  it('leaves the music alone when no chosen speaker is on the network', () => {
    expect(isEmptyPlan(planRoutes(GRAPH, ['Gone']))).toBe(true);
  });
});

describe('pairPorts', () => {
  const stereoIn = [port(2, 'in', 'FL'), port(3, 'in', 'FR')];
  const stereoOut = [port(4, 'out', 'FL'), port(5, 'out', 'FR')];

  it('feeds every channel from a mono output, and a mono input from every channel', () => {
    expect(pairPorts([port(1, 'out', 'MONO')], stereoIn)).toEqual([
      [1, 2],
      [1, 3]
    ]);
    expect(pairPorts(stereoOut, [port(6, 'in', 'MONO')])).toEqual([
      [4, 6],
      [5, 6]
    ]);
    expect(pairPorts([], stereoIn)).toEqual([]);
  });

  it('pairs in order when the channel names do not match', () => {
    const outputs = [port(1, 'out', 'AUX0'), port(2, 'out', 'AUX1'), port(3, 'out', 'AUX2')];
    expect(pairPorts(outputs, stereoIn)).toEqual([
      [1, 2],
      [2, 3]
    ]);
  });
});

describe('PipeWire', () => {
  it('reads the graph with pw-dump', async () => {
    const run = stub({ [PW_DUMP]: { code: 0, stdout: dump() } });
    const graph = await new PipeWire(run).graph();
    expect(playersOf(graph)).toHaveLength(1);
    expect(run).toHaveBeenCalledWith([PW_DUMP, '--no-colors']);
  });

  it('turns a failed pw-dump into an error', async () => {
    const pipewire = new PipeWire(stub({ [PW_DUMP]: { code: 1, stderr: 'no daemon' } }));
    await expect(pipewire.graph()).rejects.toThrow(PipeWireError);
  });

  it('links before unlinking', async () => {
    const run = stub();
    await expect(new PipeWire(run).apply({ connect: [[71, 51]], disconnect: [80] })).resolves.toBe(true);
    expect(run.mock.calls).toEqual([[[PW_LINK, '71', '51']], [[PW_LINK, '--disconnect', '80']]]);
  });

  it('reports failures, but a link that exists already is fine', async () => {
    silence('warn');
    const exists = stub({ [PW_LINK]: { code: 1, stderr: 'failed to link ports: File exists' } });
    await expect(new PipeWire(exists).apply({ connect: [[71, 51]], disconnect: [] })).resolves.toBe(true);
    const broken = stub({ [PW_LINK]: { code: 1, stderr: 'no such port' } });
    await expect(new PipeWire(broken).apply({ connect: [[71, 51]], disconnect: [80] })).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});

describe('runCommand', () => {
  it('returns the output of a program', async () => {
    await expect(runCommand(['/bin/echo', 'hi'])).resolves.toEqual({ code: 0, stdout: 'hi\n', stderr: '' });
  });

  it('returns the exit status of a failing program', async () => {
    await expect(runCommand(['/bin/false'])).resolves.toMatchObject({ code: 1 });
  });

  it('returns 127 for a program that does not exist', async () => {
    await expect(runCommand(['/nonexistent/program'])).resolves.toMatchObject({ code: 127 });
  });
});
