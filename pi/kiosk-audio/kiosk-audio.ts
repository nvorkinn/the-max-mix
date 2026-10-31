// The kiosk's audio routing and local service (see README.md), run as the kiosk user next to its PipeWire:
//   node kiosk-audio.ts watch   the background unit. It answers the app on 127.0.0.1 (server.ts: the speaker list, routing,
//                               and the kiosk buttons), and every few seconds routes any stream Chromium opened again and
//                               any chosen speaker that came back.
import { homedir } from 'node:os';
import path from 'node:path';
import { PipeWire } from './pipewire.ts';
import { serveSpeakers } from './server.ts';
import { loadSpeakers, route, saveSpeakers } from './speakers.ts';

const WATCH_MS = 2000;
const stateHome = process.env['XDG_STATE_HOME'] || path.join(homedir(), '.local', 'state');
const stateFile = path.join(stateHome, 'the-max-mix', 'speakers.json');
const pipewire = new PipeWire();

async function watchOnce(): Promise<void> {
  try {
    const speakers = await loadSpeakers(stateFile);
    // With no speakers chosen, PipeWire's own policy decides; the route request already handed the sound back.
    if (speakers.length > 0) await route(pipewire, speakers);
  } catch (error) {
    console.debug(String(error));
  }
}

if (process.argv[2] === 'watch') {
  setInterval(() => void watchOnce(), WATCH_MS);
  serveSpeakers(process.env['KIOSK_APP_ORIGIN'] ?? '', {
    graph: () => pipewire.graph(),
    route: async speakers => {
      await saveSpeakers(stateFile, speakers);
      await route(pipewire, speakers);
    }
  });
} else {
  console.error('Usage: kiosk-audio.ts watch');
  process.exit(2);
}
