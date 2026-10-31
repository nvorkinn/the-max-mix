// Starts the audio service (see service.ts and README.md): the HTTP API on 127.0.0.1, and a check every few seconds
// while speakers are chosen, so a stream Chromium opens again or a speaker that comes back is routed too.
//   node kiosk-audio.ts [--port 47878] [--origin https://app.example]... [--state path]
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PipeWire } from './pipewire.ts';
import { DEFAULT_PORT, makeServer, Router } from './service.ts';

const stateHome = process.env['XDG_STATE_HOME'] || path.join(homedir(), '.local', 'state');
const { values } = parseArgs({
  options: {
    port: { type: 'string', default: String(DEFAULT_PORT) },
    origin: { type: 'string', multiple: true, default: [] },
    state: { type: 'string', default: path.join(stateHome, 'the-max-mix', 'airplay.json') }
  }
});
const port = Number(values.port);
if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
  console.error(`Not a port: ${values.port}`);
  process.exit(2);
}

const RECONCILE_MS = 2000;
const router = new Router(new PipeWire(), values.state);
await router.load();

async function reconcile(): Promise<void> {
  try {
    await router.reconcile();
  } catch (error) {
    console.debug(String(error));
  }
}
setInterval(() => void reconcile(), RECONCILE_MS);

const origins = new Set(values.origin);
makeServer(router, port, origins).listen(port, '127.0.0.1', () => {
  console.info(`Listening on http://127.0.0.1:${port} for ${[...origins].join(', ') || 'local programs only'}`);
});
