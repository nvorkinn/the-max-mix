// The chosen speakers: read from a kiosk-audio:// link, saved to a file, and turned into PipeWire links.
//
//   kiosk-audio://route?speaker=Kitchen&speaker=Lounge   plays to those outputs (by the name Chromium shows for them)
//   kiosk-audio://route                                  hands the sound back to the Pi's default output
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isEmptyPlan, planRoutes } from './pipewire.ts';
import type { Graph, Plan } from './pipewire.ts';

const SCHEME = 'kiosk-audio:';
const MAX_SPEAKERS = 16;
const MAX_NAME_LENGTH = 256;

/** What routing needs from PipeWire; tests pass a fake. */
export interface AudioGraph {
  graph: () => Promise<Graph>;
  apply: (plan: Plan) => Promise<boolean>;
}

const isBadName = (name: unknown) => typeof name !== 'string' || name.length === 0 || name.length > MAX_NAME_LENGTH;

/** The speaker list from a link or the saved file, or null when it is not a short list of short names. */
export function validSpeakers(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_SPEAKERS) return null;
  const names = value as unknown[];
  return names.some(name => isBadName(name)) ? null : [...new Set(names as string[])];
}

/** The speakers a kiosk-audio://route link asks for, or null for any other link. A page made the link, so it is checked. */
export function parseLink(link: string): string[] | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  // Chromium hands over kiosk-audio://route or kiosk-audio:route, depending on how the page wrote it.
  const target = (url.host || url.pathname).split('/').filter(Boolean).join('/');
  return target === 'route' && url.protocol === SCHEME ? validSpeakers(url.searchParams.getAll('speaker')) : null;
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
