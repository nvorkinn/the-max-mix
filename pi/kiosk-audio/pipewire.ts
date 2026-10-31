// PipeWire through pw-dump and pw-link, without a shell. Reads the graph (nodes, ports, links and the default sink) from
// `pw-dump` and works out which links send the browser's audio to the chosen AirPlay (RAOP) sinks. `run` is injectable
// so tests stub it.
import { execFile } from 'node:child_process';

const COMMAND_TIMEOUT_MS = 10_000;
// Absolute paths, so nothing on PATH can stand in for them (both come with the pipewire-bin package).
export const PW_DUMP = '/usr/bin/pw-dump';
export const PW_LINK = '/usr/bin/pw-link';
// Chromium's audio reaches PipeWire through pipewire-pulse as an output stream named after the browser.
const PLAYER_NAMES = ['chromium', 'chrome'];

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type Run = (argv: string[]) => Promise<CommandResult>;

/** A fixed environment, plus the runtime directory that holds the user's PipeWire socket. */
function commandEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { LC_ALL: 'C' };
  const runtime = process.env['XDG_RUNTIME_DIR'];
  if (runtime) env['XDG_RUNTIME_DIR'] = runtime;
  return env;
}

/** Runs a program without a shell. 124 means it timed out, 127 that it could not start. */
export const runCommand: Run = ([file = '', ...args]) =>
  new Promise(resolve => {
    execFile(
      // Callers pass absolute paths (PW_DUMP, PW_LINK), so PATH is never searched.
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      file,
      args,
      { env: commandEnvironment(), timeout: COMMAND_TIMEOUT_MS, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr });
        } else if (typeof error.code === 'number') {
          resolve({ code: error.code, stdout, stderr });
        } else {
          resolve({ code: error.killed ? 124 : 127, stdout, stderr: stderr || error.message });
        }
      }
    );
  });

/** PipeWire could not be read or changed. */
export class PipeWireError extends Error {
  override name = 'PipeWireError';
}

export interface Node {
  id: number;
  name: string;
  description: string;
  mediaClass: string;
  props: Record<string, unknown>;
}

export interface Port {
  id: number;
  node: number;
  direction: 'in' | 'out';
  channel: string;
  isMonitor: boolean;
}

interface Link {
  id: number;
  outputPort: number;
  inputPort: number;
}

export interface Graph {
  nodes: Node[];
  ports: Port[];
  links: Link[];
  defaultSink: string | null;
}

const isSink = (node: Node): boolean => node.mediaClass === 'Audio/Sink';

/** A sink made by libpipewire-module-raop-sink (raop-discover names them raop_sink.<host>.<ip>.<port>). */
export const isAirPlay = (node: Node): boolean =>
  isSink(node) && (node.name.startsWith('raop_sink.') || Object.keys(node.props).some(key => key.startsWith('raop.')));

/** An output stream of the kiosk's browser, which is where the Web Playback SDK plays. */
function isPlayer(node: Node): boolean {
  if (node.mediaClass !== 'Stream/Output/Audio') return false;
  const names = [node.props['application.process.binary'], node.props['application.name']];
  return names.some(
    name => typeof name === 'string' && PLAYER_NAMES.some(player => name.toLowerCase().includes(player))
  );
}

/** The AirPlay sinks, sorted by name for a stable list on screen. */
export const speakersOf = (graph: Graph): Node[] =>
  graph.nodes.filter(node => isAirPlay(node)).toSorted((a, b) => a.description.localeCompare(b.description));

export const playersOf = (graph: Graph): Node[] => graph.nodes.filter(node => isPlayer(node));

const portsOf = (graph: Graph, node: number, direction: Port['direction']) =>
  graph.ports.filter(port => port.node === node && port.direction === direction && !port.isMonitor);

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asRecord = (value: unknown): Json => (isRecord(value) ? value : {});
const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function defaultSinkOf(entries: unknown): string | null {
  const list: unknown[] = Array.isArray(entries) ? entries : [];
  const entry = list.find(item => isRecord(item) && item['key'] === 'default.audio.sink');
  const name = asRecord(parseJsonValue(asRecord(entry)['value']))['name'];
  return typeof name === 'string' ? name : null;
}

/** Adds one pw-dump object to the graph; objects that are malformed or were removed (no info) are skipped. */
function addObject(graph: Graph, item: Json, id: number): void {
  const info = asRecord(item['info']);
  const props = asRecord(info['props']);
  const type = item['type'];
  if (type === 'PipeWire:Interface:Node' && Object.keys(props).length > 0) {
    const name = asString(props['node.name']);
    const description = asString(props['node.description']) || asString(props['node.nick']) || name;
    graph.nodes.push({ id, name, description, mediaClass: asString(props['media.class']), props });
  } else if (type === 'PipeWire:Interface:Port' && typeof props['node.id'] === 'number') {
    const direction = asString(info['direction']) || asString(props['port.direction']);
    graph.ports.push({
      id,
      node: props['node.id'],
      direction: direction.startsWith('in') ? 'in' : 'out',
      channel: asString(props['audio.channel']),
      isMonitor: props['port.monitor'] === true
    });
  } else if (type === 'PipeWire:Interface:Link') {
    const outputPort = info['output-port-id'];
    const inputPort = info['input-port-id'];
    if (typeof outputPort === 'number' && typeof inputPort === 'number') {
      graph.links.push({ id, outputPort, inputPort });
    }
  } else if (type === 'PipeWire:Interface:Metadata' && asRecord(item['props'])['metadata.name'] === 'default') {
    graph.defaultSink = defaultSinkOf(item['metadata']) ?? graph.defaultSink;
  }
}

/** The graph from `pw-dump` JSON. */
export function parseDump(text: string): Graph {
  let objects: unknown;
  try {
    objects = JSON.parse(text) as unknown;
  } catch (error) {
    throw new PipeWireError(`pw-dump did not return JSON: ${String(error)}`);
  }
  if (!Array.isArray(objects)) throw new PipeWireError('pw-dump did not return a list');
  const graph: Graph = { nodes: [], ports: [], links: [], defaultSink: null };
  const items: unknown[] = objects;
  for (const item of items) {
    if (isRecord(item) && typeof item['id'] === 'number') addObject(graph, item, item['id']);
  }
  return graph;
}

type Pair = [output: number, input: number];

/** Output port → input port pairs: by channel name, else in order; a mono side feeds or takes every channel. */
export function pairPorts(outputs: Port[], inputs: Port[]): Pair[] {
  const [firstOutput] = outputs;
  const [firstInput] = inputs;
  if (!firstOutput || !firstInput) return [];
  if (outputs.length === 1) return inputs.map(port => [firstOutput.id, port.id]);
  if (inputs.length === 1) return outputs.map(port => [port.id, firstInput.id]);
  const byChannel = new Map(inputs.filter(port => port.channel).map(port => [port.channel, port]));
  const pairs: Pair[] = [];
  for (const [index, port] of outputs.entries()) {
    const target = byChannel.get(port.channel) ?? inputs[index];
    if (target) pairs.push([port.id, target.id]);
  }
  return pairs;
}

export interface Plan {
  connect: Pair[];
  /** Link ids. */
  disconnect: number[];
}

export const isEmptyPlan = (plan: Plan): boolean => plan.connect.length === 0 && plan.disconnect.length === 0;

/** The sinks the browser should play to: the chosen speakers that are on the network, or else the default output. */
function targetsOf(graph: Graph, speakers: readonly string[]): Node[] {
  if (speakers.length > 0) return speakersOf(graph).filter(node => speakers.includes(node.name));
  const fallback = graph.nodes.find(node => node.name === graph.defaultSink);
  return fallback && isSink(fallback) ? [fallback] : [];
}

const pairKey = ([output, input]: Pair) => `${output}:${input}`;

/** Adds to `plan` what one browser stream needs. */
function planPlayer(graph: Graph, player: Node, targets: Node[], plan: Plan): void {
  const outputs = portsOf(graph, player.id, 'out');
  const wanted = new Map<string, Pair>();
  for (const sink of targets) {
    const pairs = pairPorts(outputs, portsOf(graph, sink.id, 'in'));
    for (const pair of pairs) wanted.set(pairKey(pair), pair);
  }
  const outputIds = new Set(outputs.map(port => port.id));
  const portNode = new Map(graph.ports.map(port => [port.id, port.node]));
  const existing = new Set<string>();
  for (const link of graph.links) {
    if (!outputIds.has(link.outputPort)) continue;
    const key = pairKey([link.outputPort, link.inputPort]);
    existing.add(key);
    const target = graph.nodes.find(node => node.id === portNode.get(link.inputPort));
    if (target && isSink(target) && !wanted.has(key)) plan.disconnect.push(link.id);
  }
  for (const [key, pair] of wanted) {
    if (!existing.has(key)) plan.connect.push(pair);
  }
}

/**
 * The changes that send every browser stream to exactly these AirPlay sinks (by node name), or, with no speakers, back
 * to the default sink only. Links to anything other than a sink (a level meter, a recorder) are left alone. When none of
 * the chosen speakers is on the network, nothing changes, so the music is never cut off by a speaker that went away.
 */
export function planRoutes(graph: Graph, speakers: readonly string[]): Plan {
  const plan: Plan = { connect: [], disconnect: [] };
  const targets = targetsOf(graph, speakers);
  if (targets.length === 0) return plan;
  for (const player of playersOf(graph)) planPlayer(graph, player, targets, plan);
  return {
    connect: plan.connect.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]),
    disconnect: plan.disconnect.toSorted((a, b) => a - b)
  };
}

export class PipeWire {
  private readonly run: Run;

  constructor(run: Run = runCommand) {
    this.run = run;
  }

  async graph(): Promise<Graph> {
    const { code, stdout, stderr } = await this.run([PW_DUMP, '--no-colors']);
    if (code !== 0) throw new PipeWireError(`pw-dump failed (${code}): ${stderr.trim()}`);
    return parseDump(stdout);
  }

  /**
   * Makes the new links before removing the old ones, so the music does not drop out in between. Returns true when
   * every change worked; a link that already exists counts as done. One at a time, because pw-link changes one graph.
   */
  async apply(plan: Plan): Promise<boolean> {
    let isComplete = true;
    for (const [output, input] of plan.connect) {
      // eslint-disable-next-line no-await-in-loop
      const { code, stderr } = await this.run([PW_LINK, String(output), String(input)]);
      if (code === 0 || stderr.includes('File exists')) continue;
      console.warn(`pw-link ${output} ${input} failed: ${stderr.trim()}`);
      isComplete = false;
    }
    for (const link of plan.disconnect) {
      // eslint-disable-next-line no-await-in-loop
      const { code, stderr } = await this.run([PW_LINK, '--disconnect', String(link)]);
      if (code === 0) continue;
      console.warn(`pw-link --disconnect ${link} failed: ${stderr.trim()}`);
      isComplete = false;
    }
    return isComplete;
  }
}
