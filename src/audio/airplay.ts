// The tablet's speaker outputs on the kiosk: AirPlay speakers and connected Bluetooth speakers. PipeWire makes an output
// for each; the kiosk's audio service (pi/kiosk-audio/server.ts) lists them over http://127.0.0.1 and routes the sound
// to the chosen ones (POST /audio/route). It also says which ones the sound really goes to (`linked`). A Pi still on an
// older service lists names only and cannot say where the sound goes, so the page remembers its own last choice.
import { errorMessage } from '../utils/errorMessage';
import { KIOSK_SERVICE, kioskPost } from '../utils/kioskService';

const SPEAKERS_KEY = 'maxmix.airplaySpeakers';
const POLL_MS = 5000;

/** One speaker output. */
export interface AudioOutput {
  /** The Pi's id for it (PipeWire's node name), or its name on a Pi still on an older service. */
  id: string;
  name: string;
  /** null on an older Pi, which does not say. */
  kind: 'airplay' | 'bluetooth' | null;
  /** A Bluetooth speaker's address, as the Bluetooth list has it. */
  address?: string;
  /** Percent, or null when the speaker reports none. */
  volume: number | null;
  /** Whether the sound goes to it now; null on an older Pi, which does not say. */
  linked: boolean | null;
}

const isPercent = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 100;

function parseOutput(item: unknown): AudioOutput | null {
  const entry = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
  const { id, name, kind, address, volume, linked } = entry;
  if (typeof id !== 'string' || typeof name !== 'string' || (kind !== 'airplay' && kind !== 'bluetooth')) return null;
  return {
    id,
    name,
    kind,
    ...(typeof address === 'string' && { address }),
    volume: isPercent(volume) ? Math.round(volume) : null,
    linked: linked === true
  };
}

/** The outputs from an older Pi's answer: names and volumes only. */
function legacyOutputs(body: { speakers?: unknown; volumes?: unknown }): AudioOutput[] {
  const names = Array.isArray(body.speakers) ? body.speakers.filter(name => typeof name === 'string') : [];
  const volumes = (typeof body.volumes === 'object' && body.volumes !== null ? body.volumes : {}) as Record<
    string,
    unknown
  >;
  return [...new Set(names)].map(name => {
    const volume = volumes[name];
    return { id: name, name, kind: null, volume: isPercent(volume) ? Math.round(volume) : null, linked: null };
  });
}

/** The speaker outputs the Pi has, by name; `legacy` when the Pi is still on an older service. */
export async function listAudioOutputs(): Promise<{ outputs: AudioOutput[]; legacy: boolean }> {
  let response: Response;
  try {
    response = await fetch(`${KIOSK_SERVICE}/speakers`, { cache: 'no-store' });
  } catch (error) {
    throw new Error(`The kiosk’s audio service did not answer: ${errorMessage(error)}`, { cause: error });
  }
  if (!response.ok) throw new Error(`The kiosk’s audio service could not read PipeWire (${response.status}).`);
  const body = (await response.json()) as { speakers?: unknown; volumes?: unknown; outputs?: unknown };
  const legacy = !Array.isArray(body.outputs);
  const outputs = Array.isArray(body.outputs)
    ? (body.outputs as unknown[]).map(item => parseOutput(item)).filter(output => output !== null)
    : legacyOutputs(body);
  return { outputs: outputs.toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)), legacy };
}

/** Calls `onChange` every few seconds, since speakers come and go on the network; returns the unsubscribe function. */
export function watchAudioOutputs(onChange: () => void): () => void {
  const timer = setInterval(onChange, POLL_MS);
  return () => clearInterval(timer);
}

/**
 * Asks the Pi to play to exactly these outputs, by id; with none, the Pi's own output. `legacy`: the Pi is still on an
 * older service, which takes names (the ids it gave are the names).
 */
export function routeAudio(ids: readonly string[], legacy = false): void {
  kioskPost('/audio/route', legacy ? { speakers: ids } : { outputs: ids });
}

// Per output: whether a volume request is on its way, and the newest value to send once it is back.
const volumeRequests = new Map<string, { latest: number | null }>();

/**
 * Sets one output's volume (0 to 100). While dragging, only one request per output is on its way at a time, and the
 * newest value follows when it is back, so the Pi is not asked for every step.
 */
export function setSpeakerVolume(output: Pick<AudioOutput, 'id' | 'kind'>, volume: number): void {
  const pending = volumeRequests.get(output.id);
  if (pending) {
    pending.latest = volume;
    return;
  }
  const request = { latest: null as number | null };
  volumeRequests.set(output.id, request);
  const target = output.kind === null ? { speaker: output.id } : { output: output.id };
  void (async () => {
    let next: number | null = volume;
    while (next !== null) {
      request.latest = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(`${KIOSK_SERVICE}/audio/volume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...target, volume: next })
        });
        if (!response.ok) console.warn(`The kiosk refused the volume of ${output.id} (${response.status})`);
      } catch (error) {
        console.warn(`The kiosk did not answer the volume of ${output.id}`, error);
      }
      next = request.latest;
    }
    volumeRequests.delete(output.id);
  })();
}

/** The outputs this page last routed to, for a Pi that cannot say itself. */
export function getChosenSpeakers(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SPEAKERS_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((name): name is string => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

export function setChosenSpeakers(speakers: readonly string[]): void {
  try {
    localStorage.setItem(SPEAKERS_KEY, JSON.stringify(speakers));
  } catch {
    // Storage is unavailable; the choice then lasts only until the page reloads.
  }
}
