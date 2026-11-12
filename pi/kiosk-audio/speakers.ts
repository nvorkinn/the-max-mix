// The chosen speakers: checked, saved to a file, and turned into PipeWire links.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseAddress } from './bluetooth.ts';
import { isEmptyPlan, linkedSinks, planRoutes } from './pipewire.ts';
import type { Choice, Graph, Node, Plan } from './pipewire.ts';

const MAX_SPEAKERS = 16;
const MAX_NAME_LENGTH = 256;
const AIRPLAY_PREFIX = 'raop_sink.';
const BLUETOOTH_PREFIX = 'bluez_output.';

/** What routing needs from PipeWire; tests pass a fake. */
export interface AudioGraph {
  graph: () => Promise<Graph>;
  apply: (plan: Plan) => Promise<boolean>;
}

/**
 * The sinks PipeWire made for speakers: an AirPlay (RAOP) sink for each speaker it found on the network, and a Bluetooth
 * sink for each connected Bluetooth speaker.
 */
export const speakerSinks = (graph: Graph): Node[] =>
  graph.nodes.filter(
    node =>
      node.mediaClass === 'Audio/Sink' &&
      (node.name.startsWith(AIRPLAY_PREFIX) || node.name.startsWith(BLUETOOTH_PREFIX))
  );

/** One speaker output, as GET /speakers reports it. */
export interface Output {
  /** PipeWire's node name, which routing and volume take. */
  id: string;
  name: string;
  /** From the node name's prefix, which PipeWire's AirPlay and Bluetooth modules set. */
  kind: 'airplay' | 'bluetooth';
  /** Bluetooth only: the speaker's address as PipeWire's Bluetooth plugin reports it, as in GET /bluetooth/devices. */
  address?: string;
  /** Percent, or null when the sink reports none. */
  volume: number | null;
  /** The browser's sound goes to it now. */
  linked: boolean;
}

/** Every speaker output, by name and then id. */
export function speakerOutputs(graph: Graph): Output[] {
  const linked = linkedSinks(graph);
  return speakerSinks(graph)
    .map(node => {
      const kind = node.name.startsWith(BLUETOOTH_PREFIX) ? 'bluetooth' : 'airplay';
      const address = kind === 'bluetooth' ? parseAddress(node.props['api.bluez5.address']) : null;
      return {
        id: node.name,
        name: node.description,
        kind,
        ...(address && { address }),
        volume: node.volume === null ? null : Math.round(node.volume * 100),
        linked: linked.has(node.id)
      } satisfies Output;
    })
    .toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

const isBadName = (name: unknown) => typeof name !== 'string' || name.length === 0 || name.length > MAX_NAME_LENGTH;

/** A list from a request or the saved file, or null when it is not a short list of short strings. */
function validNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_SPEAKERS) return null;
  const names = value as unknown[];
  return names.some(name => isBadName(name)) ? null : [...new Set(names as string[])];
}

/**
 * The choice in the body of POST /audio/route, or null when it is not valid: `outputs` (ids from GET /speakers), or
 * else `speakers` (names), which older apps send.
 */
export function validChoices(body: unknown): Choice[] | null {
  const { outputs, speakers } = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  return outputs === undefined
    ? (validNames(speakers)?.map(name => ({ name })) ?? null)
    : (validNames(outputs)?.map(id => ({ id })) ?? null);
}

/** Adds each output's name, so a speaker can still be found by name once its id has changed. */
export const withNames = (graph: Graph, choices: Choice[]): Choice[] =>
  choices.map(choice => {
    const sink = choice.id === undefined ? undefined : speakerSinks(graph).find(node => node.name === choice.id);
    return sink ? { ...choice, name: sink.description } : choice;
  });

function savedChoice(value: unknown): Choice | null {
  const { id, name } = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  if ((id === undefined && name === undefined) || (id !== undefined && isBadName(id))) return null;
  if (name !== undefined && isBadName(name)) return null;
  return { ...(id !== undefined && { id: id as string }), ...(name !== undefined && { name: name as string }) };
}

/** The saved choice; a file from before outputs had ids holds `speakers` (names). */
export async function loadSpeakers(file: string): Promise<Choice[]> {
  try {
    const saved = JSON.parse(await readFile(file, 'utf8')) as { choices?: unknown; speakers?: unknown } | null;
    const list = saved?.choices;
    if (Array.isArray(list) && list.length <= MAX_SPEAKERS) {
      const choices = (list as unknown[]).map(value => savedChoice(value));
      return choices.every((choice): choice is Choice => choice !== null) ? choices : [];
    }
    return validNames(saved?.speakers)?.map(name => ({ name })) ?? [];
  } catch {
    return [];
  }
}

/** Written to a temporary file first, so the watcher never reads half a file. */
export async function saveSpeakers(file: string, choices: Choice[]): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify({ choices }));
  await rename(temporary, file);
}

/** Brings the links in line with the choice. Returns the plan it applied (empty when nothing needed to change). */
export async function route(pipewire: AudioGraph, choices: Choice[]): Promise<Plan> {
  const plan = planRoutes(await pipewire.graph(), choices);
  if (!isEmptyPlan(plan)) {
    console.info(`Routing: link ${JSON.stringify(plan.connect)}, unlink ${JSON.stringify(plan.disconnect)}`);
    await pipewire.apply(plan);
  }
  return plan;
}

/**
 * The volume request's body, or null unless it names one output (`output`, an id; or `speaker`, a name, which older
 * apps send) and a whole percentage.
 */
export function validVolume(value: unknown): { target: Choice; volume: number } | null {
  const { output, speaker, volume } = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const target = output === undefined ? speaker : output;
  if (isBadName(target) || !Number.isSafeInteger(volume)) return null;
  const percent = volume as number;
  if (percent < 0 || percent > 100) return null;
  return { target: output === undefined ? { name: target as string } : { id: target as string }, volume: percent };
}

/** What setting a speaker's volume needs from PipeWire; tests pass a fake. */
export interface VolumeControl {
  graph: () => Promise<Graph>;
  setVolume: (node: number, volume: number) => Promise<void>;
}

/**
 * Sets the volume (0 to 100) of the speaker sink with this id, or of every one with this name. Returns how many it set
 * (none: not on the network).
 */
export async function setSpeakerVolume(pipewire: VolumeControl, target: Choice, volume: number): Promise<number> {
  const sinks = speakerSinks(await pipewire.graph()).filter(node =>
    target.id === undefined ? node.description === target.name : node.name === target.id
  );
  for (const sink of sinks) {
    // eslint-disable-next-line no-await-in-loop
    await pipewire.setVolume(sink.id, volume / 100);
  }
  return sinks.length;
}
