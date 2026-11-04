// The kiosk's local service for the app, on 127.0.0.1 only:
//   GET  /speakers          {"speakers": ["Kitchen", …]}   the AirPlay sinks PipeWire made, by the names routing uses
//                           plus {"volumes": {"Kitchen": 40, …}}, each speaker's volume in percent
//   POST /audio/route       {"speakers": [...]}            route the sound to those speakers (none: the Pi's own output)
//   POST /audio/volume      {"speaker": "Kitchen", "volume": 40}   set one speaker's volume (404: not on the network)
//   POST /power/restart     restart the kiosk              POST /power/reboot    reboot the Pi
//   POST /display/wake      turn the screen back on        POST /wifi            show the Wi-Fi panel
//   WS   /power/update      pull the playbook now, restart the kiosk if that asks for it, and stream the journal of both
//                           (update-socket.ts)
// Only the app's origin is answered (CORS, and every POST and WebSocket is refused without its Origin header, so no other
// web page can trigger one). A request carries no command, only the name of one of the fixed actions in actions.ts.
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { perform } from './actions.ts';
import type { Action } from './actions.ts';
import type { Graph } from './pipewire.ts';
import { airPlaySinks, validSpeakers, validVolume } from './speakers.ts';
import { attachUpdateSocket } from './update-socket.ts';
import type { Update } from './update-socket.ts';
import { runUpdate } from './update.ts';

const SPEAKERS_PORT = 7341;
const MAX_BODY = 4096;
const POST_ACTIONS: Record<string, Action> = {
  '/power/restart': 'restart',
  '/power/reboot': 'reboot',
  '/display/wake': 'wake',
  '/wifi': 'wifi'
};

/** What the service needs: PipeWire's graph, routing, and a way to run an action; tests pass fakes. */
export interface Deps {
  graph: () => Promise<Graph>;
  route: (speakers: string[]) => Promise<void>;
  /** Sets a speaker's volume in percent; false when no speaker has that name. */
  setVolume: (speaker: string, volume: number) => Promise<boolean>;
  perform: (action: Action) => Promise<void>;
}

/** The AirPlay (RAOP) sinks' names, sorted, once each. */
export const speakerNames = (graph: Graph): string[] =>
  [...new Set(airPlaySinks(graph).map(node => node.description))].toSorted((a, b) => a.localeCompare(b));

/** Each AirPlay speaker's volume in percent, for the ones that report one. */
export function speakerVolumes(graph: Graph): Record<string, number> {
  const volumes: Record<string, number> = {};
  for (const node of airPlaySinks(graph)) {
    if (node.volume !== null) volumes[node.description] ??= Math.round(node.volume * 100);
  }
  return volumes;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new RangeError('The request is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function post(request: IncomingMessage, response: ServerResponse, deps: Deps): Promise<void> {
  const action = POST_ACTIONS[request.url ?? ''];
  if (action) {
    await deps.perform(action);
  } else if (request.url === '/audio/route') {
    const speakers = validSpeakers((JSON.parse(await readBody(request)) as { speakers?: unknown } | null)?.speakers);
    if (!speakers) {
      response.writeHead(400).end();
      return;
    }
    await deps.route(speakers);
  } else if (request.url === '/audio/volume') {
    const body = validVolume(JSON.parse(await readBody(request)) as unknown);
    if (!body) {
      response.writeHead(400).end();
      return;
    }
    if (!(await deps.setVolume(body.speaker, body.volume))) {
      response.writeHead(404).end();
      return;
    }
  } else {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(204).end();
}

export function handleRequest(origin: string, deps: Deps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // Chromium asks before a public page reads from this machine (Private Network Access).
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
    response.setHeader('Cache-Control', 'no-store');
    try {
      if (request.method === 'OPTIONS') {
        response.writeHead(204).end();
      } else if (request.method === 'GET' && request.url === '/speakers') {
        const graph = await deps.graph();
        const body = { speakers: speakerNames(graph), volumes: speakerVolumes(graph) };
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
      } else if (request.method === 'POST') {
        if (request.headers.origin === origin) await post(request, response, deps);
        else response.writeHead(403).end();
      } else {
        response.writeHead(404).end();
      }
    } catch (error) {
      response.writeHead(503, { 'Content-Type': 'text/plain' }).end(String(error));
    }
  };
}

export function serveSpeakers(origin: string, deps: Omit<Deps, 'perform'>, update: Update = runUpdate): Server {
  const handler = handleRequest(origin, { ...deps, perform });
  const server = createServer((request, response) => void handler(request, response));
  attachUpdateSocket(server, origin, update);
  return server.listen(SPEAKERS_PORT, '127.0.0.1');
}
