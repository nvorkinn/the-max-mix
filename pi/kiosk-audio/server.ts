// The speaker list for the app, on 127.0.0.1 only: GET /speakers answers {"speakers": ["Kitchen", …]}, the AirPlay sinks
// PipeWire made, by the names routing uses. Only the app's origin may read it (CORS); it changes nothing.
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Graph } from './pipewire.ts';

const SPEAKERS_PORT = 7341;

/** The AirPlay (RAOP) sinks' names, sorted, once each. */
export const speakerNames = (graph: Graph): string[] =>
  [
    ...new Set(
      graph.nodes
        .filter(node => node.mediaClass === 'Audio/Sink' && node.name.startsWith('raop_sink.'))
        .map(node => node.description)
    )
  ].toSorted((a, b) => a.localeCompare(b));

export function handleRequest(origin: string, graph: () => Promise<Graph>) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'GET');
    // Chromium asks before a public page reads from this machine (Private Network Access).
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
    } else if (request.method === 'GET' && request.url === '/speakers') {
      try {
        const speakers = speakerNames(await graph());
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ speakers }));
      } catch (error) {
        response.writeHead(503, { 'Content-Type': 'text/plain' }).end(String(error));
      }
    } else {
      response.writeHead(404).end();
    }
  };
}

export function serveSpeakers(origin: string, graph: () => Promise<Graph>): Server {
  const handler = handleRequest(origin, graph);
  return createServer((request, response) => void handler(request, response)).listen(SPEAKERS_PORT, '127.0.0.1');
}
