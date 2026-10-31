// THE MAX MIX audio service: a small HTTP API on 127.0.0.1 that lists the AirPlay speakers PipeWire found and sends the
// kiosk browser's audio to the ones chosen in the app.
//
//   GET /v1/airplay                      → {"speakers": [{"id", "nodeId", "name", "selected"}], "selected": [...], "playing"}
//   PUT /v1/airplay {"speakers": [id…]}  → the same, after routing; [] hands the audio back to the default output
//
// It only listens on the loopback address, answers only requests whose Host is that address (no DNS rebinding) and, from
// a browser, only the app's own origin (CORS, including Chrome's private network preflight).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import path from 'node:path';
import { isEmptyPlan, PipeWireError, planRoutes, playersOf, speakersOf } from './pipewire.ts';
import type { Graph, Plan } from './pipewire.ts';

export const DEFAULT_PORT = 47_878;
const API_PATH = '/v1/airplay';
const MAX_BODY_BYTES = 4096;
const MAX_SPEAKERS = 16;
const MAX_NAME_LENGTH = 256;

/** What the router needs from PipeWire; tests pass a fake. */
export interface AudioGraph {
  graph: () => Promise<Graph>;
  apply: (plan: Plan) => Promise<boolean>;
}

export interface Status {
  speakers: { id: string; nodeId: number; name: string; selected: boolean }[];
  selected: string[];
  playing: boolean;
}

/** The speaker list from a request or the saved file, or null when it is not a short list of short strings. */
export function validSpeakers(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_SPEAKERS) return null;
  const names = value as unknown[];
  return names.every(name => typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME_LENGTH)
    ? (names as string[])
    : null;
}

/** Resolves once `promise` has settled, whichever way. */
async function settled(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // Only the order matters here; the caller of the failed work gets its error.
  }
}

/**
 * The chosen speakers (PipeWire node names, which stay the same when a speaker drops off and comes back) and the work of
 * keeping the links in line with them. The choice is saved, so it survives a restart. Calls are queued, so a check from
 * the background loop never runs in the middle of a change from the app.
 */
export class Router {
  private readonly pipewire: AudioGraph;
  private readonly statePath: string | null;
  private queue: Promise<void> = Promise.resolve();
  speakers: string[] = [];

  constructor(pipewire: AudioGraph, statePath: string | null = null) {
    this.pipewire = pipewire;
    this.statePath = statePath;
  }

  private async save(): Promise<void> {
    if (!this.statePath) return;
    try {
      await mkdir(path.dirname(this.statePath), { recursive: true });
      const temporary = `${this.statePath}.tmp`;
      await writeFile(temporary, JSON.stringify({ speakers: this.speakers }));
      await rename(temporary, this.statePath);
    } catch (error) {
      console.warn(`Could not save the speakers: ${String(error)}`);
    }
  }

  /** Runs `work` once everything queued before it has finished. */
  private async serialize<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    const current = (async () => {
      await previous;
      return work();
    })();
    this.queue = settled(current);
    return current;
  }

  private async route(): Promise<void> {
    const plan = planRoutes(await this.pipewire.graph(), this.speakers);
    if (isEmptyPlan(plan)) return;
    console.info(`Routing: link ${JSON.stringify(plan.connect)}, unlink ${JSON.stringify(plan.disconnect)}`);
    await this.pipewire.apply(plan);
  }

  async load(): Promise<void> {
    if (!this.statePath) return;
    try {
      const saved = JSON.parse(await readFile(this.statePath, 'utf8')) as unknown;
      this.speakers = validSpeakers((saved as { speakers?: unknown } | null)?.speakers) ?? [];
    } catch {
      this.speakers = [];
    }
  }

  async status(): Promise<Status> {
    const graph = await this.pipewire.graph();
    return {
      speakers: speakersOf(graph).map(node => ({
        id: node.name,
        nodeId: node.id,
        name: node.description,
        selected: this.speakers.includes(node.name)
      })),
      selected: [...this.speakers],
      playing: playersOf(graph).length > 0
    };
  }

  /** With no speakers the audio goes back to the default output once; then PipeWire's own policy is left alone. */
  choose(speakers: string[]): Promise<Status> {
    return this.serialize(async () => {
      this.speakers = [...new Set(speakers)];
      await this.save();
      await this.route();
      return this.status();
    });
  }

  /** One pass of the background loop; does nothing unless speakers are chosen. */
  reconcile(): Promise<void> {
    return this.serialize(async () => {
      if (this.speakers.length > 0) await this.route();
    });
  }
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  const length = Number(request.headers['content-length']);
  if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_BODY_BYTES) {
    return Promise.reject(new HttpError(400, 'Missing or oversized body'));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(400, 'Missing or oversized body'));
        request.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

async function speakersFrom(request: IncomingMessage): Promise<string[]> {
  // A JSON content type makes a browser send the CORS preflight first, so no other site can fire this blind.
  if (request.headers['content-type']?.split(';', 1)[0]?.trim() !== 'application/json') {
    throw new HttpError(415, 'Send JSON');
  }
  let body: unknown;
  try {
    body = JSON.parse(await readBody(request)) as unknown;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    body = null;
  }
  const speakers = validSpeakers((body as { speakers?: unknown } | null)?.speakers);
  if (!speakers) throw new HttpError(400, 'Expected {"speakers": [names]}');
  return speakers;
}

/** The request handler. `port` is the one the server listens on, which is the only Host it accepts. */
export function makeHandler(router: Router, port: number, origins: ReadonlySet<string>) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const origin = request.headers.origin;
    const send = (status: number, body?: unknown, extra: Record<string, string> = {}) => {
      const payload = body === undefined ? '' : JSON.stringify(body);
      response.statusCode = status;
      if (origin && origins.has(origin)) response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Cache-Control', 'no-store');
      for (const [name, value] of Object.entries(extra)) response.setHeader(name, value);
      if (payload) response.setHeader('Content-Type', 'application/json');
      response.setHeader('Content-Length', Buffer.byteLength(payload));
      response.end(payload);
    };

    if (!hosts.has(request.headers.host ?? '')) {
      send(421, { error: 'Unknown host' });
      return;
    }
    // Programs on the Pi itself (curl) send no Origin; every browser does on a cross-origin request.
    if (origin !== undefined && !origins.has(origin)) {
      send(403, { error: 'Origin not allowed' });
      return;
    }
    if ((request.url ?? '').split('?', 1)[0] !== API_PATH) {
      send(404, { error: 'Not found' });
      return;
    }
    try {
      switch (request.method) {
        case 'OPTIONS': {
          const extra: Record<string, string> = {
            'Access-Control-Allow-Methods': 'GET, PUT',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '600'
          };
          // Chrome asks before a public page (the app on Vercel) may reach a loopback address.
          if (request.headers['access-control-request-private-network'] === 'true') {
            extra['Access-Control-Allow-Private-Network'] = 'true';
          }
          send(204, undefined, extra);
          break;
        }
        case 'GET': {
          send(200, await router.status());
          break;
        }
        case 'PUT': {
          send(200, await router.choose(await speakersFrom(request)));
          break;
        }
        default: {
          send(405, { error: 'Method not allowed' }, { Allow: 'GET, PUT, OPTIONS' });
        }
      }
    } catch (error) {
      if (error instanceof HttpError) {
        send(error.status, { error: error.message });
      } else if (error instanceof PipeWireError) {
        console.warn(error.message);
        send(503, { error: 'PipeWire is not available' });
      } else {
        console.error(error);
        send(500, { error: 'Internal error' });
      }
    }
  };
}

/** An HTTP server for the router, not yet listening. */
export function makeServer(router: Router, port: number, origins: ReadonlySet<string>): Server {
  const handle = makeHandler(router, port, origins);
  return createServer((request, response) => {
    void handle(request, response);
  });
}
