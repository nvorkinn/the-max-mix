// The chosen speakers: checked, saved to a file, and turned into PipeWire links.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isEmptyPlan, planRoutes } from './pipewire.ts';
import type { Graph, Node, Plan } from './pipewire.ts';

const MAX_SPEAKERS = 16;
const MAX_NAME_LENGTH = 256;

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
      node.mediaClass === 'Audio/Sink' && (node.name.startsWith('raop_sink.') || node.name.startsWith('bluez_output.'))
  );

const isBadName = (name: unknown) => typeof name !== 'string' || name.length === 0 || name.length > MAX_NAME_LENGTH;

/** The speaker list from a request or the saved file, or null when it is not a short list of short names. */
export function validSpeakers(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_SPEAKERS) return null;
  const names = value as unknown[];
  return names.some(name => isBadName(name)) ? null : [...new Set(names as string[])];
}

export async function loadSpeakers(file: string): Promise<string[]> {
  try {
    const saved = JSON.parse(await readFile(file, 'utf8')) as { speakers?: unknown } | null;
    return validSpeakers(saved?.speakers) ?? [];
  } catch {
    return [];
  }
}

/** Written to a temporary file first, so the watcher never reads half a file. */
export async function saveSpeakers(file: string, speakers: string[]): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify({ speakers }));
  await rename(temporary, file);
}

/** Brings the links in line with the speakers. Returns the plan it applied (empty when nothing needed to change). */
export async function route(pipewire: AudioGraph, speakers: string[]): Promise<Plan> {
  const plan = planRoutes(await pipewire.graph(), speakers);
  if (!isEmptyPlan(plan)) {
    console.info(`Routing: link ${JSON.stringify(plan.connect)}, unlink ${JSON.stringify(plan.disconnect)}`);
    await pipewire.apply(plan);
  }
  return plan;
}

/** The volume request's body, or null unless it names one speaker and a whole percentage. */
export function validVolume(value: unknown): { speaker: string; volume: number } | null {
  const { speaker, volume } = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  if (isBadName(speaker) || !Number.isSafeInteger(volume)) return null;
  const percent = volume as number;
  return percent >= 0 && percent <= 100 ? { speaker: speaker as string, volume: percent } : null;
}

/** What setting a speaker's volume needs from PipeWire; tests pass a fake. */
export interface VolumeControl {
  graph: () => Promise<Graph>;
  setVolume: (node: number, volume: number) => Promise<void>;
}

/** Sets the volume (0 to 100) of every speaker sink with this name. Returns how many it set (none: not on the network). */
export async function setSpeakerVolume(pipewire: VolumeControl, speaker: string, volume: number): Promise<number> {
  const sinks = speakerSinks(await pipewire.graph()).filter(node => node.description === speaker);
  for (const sink of sinks) {
    // eslint-disable-next-line no-await-in-loop
    await pipewire.setVolume(sink.id, volume / 100);
  }
  return sinks.length;
}
