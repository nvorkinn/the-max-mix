// The kiosk's audio routing and local service (see README.md), run as the kiosk user next to its PipeWire:
//   node kiosk-audio.ts watch   the background unit. It answers the app on 127.0.0.1 (server.ts: the speaker list, routing,
//                               the kiosk buttons, and the update stream), and every few seconds routes any stream Chromium opened again and
//                               any chosen speaker that came back.
import { homedir } from 'node:os';
import path from 'node:path';
import { Nmcli } from './nmcli.ts';
import type { ConnectRequest } from './nmcli.ts';
import { PipeWire } from './pipewire.ts';
import { serveSpeakers } from './server.ts';
import { loadSpeakers, route, saveSpeakers, setSpeakerVolume, withNames } from './speakers.ts';
import { stopFollowers } from './update.ts';
import { chromiumPid, stopChromium } from './watchdog.ts';

const WATCH_MS = 2000;
const stateHome = process.env['XDG_STATE_HOME'] || path.join(homedir(), '.local', 'state');
const stateFile = path.join(stateHome, 'the-max-mix', 'speakers.json');
const pipewire = new PipeWire();

/** NetworkManager for the Wi-Fi setup page, and closing that page: it shows in a Chromium of its own. */
function wifi() {
  const nmcli = new Nmcli();
  return {
    scan: () => nmcli.scan(),
    connect: (request: ConnectRequest) => nmcli.connect(request),
    done: () => {
      void (async () => {
        const pid = await chromiumPid();
        if (pid !== null) await stopChromium(pid);
      })();
    }
  };
}

async function watchOnce(): Promise<void> {
  try {
    const choices = await loadSpeakers(stateFile);
    // With no speakers chosen, PipeWire's own policy decides; the route request already handed the sound back.
    if (choices.length > 0) await route(pipewire, choices);
  } catch (error) {
    console.debug(String(error));
  }
}

if (process.argv[2] === 'watch') {
  // An update follows the journal with journalctl processes: none may outlive this service.
  process.on('exit', stopFollowers);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => process.exit(0));
  setInterval(() => void watchOnce(), WATCH_MS);
  serveSpeakers(process.env['KIOSK_APP_ORIGIN'] ?? '', {
    graph: () => pipewire.graph(),
    route: async choices => {
      await saveSpeakers(stateFile, withNames(await pipewire.graph(), choices));
      await route(pipewire, choices);
    },
    setVolume: (target, volume) => setSpeakerVolume(pipewire, target, volume),
    wifi: wifi()
  });
} else {
  console.error('Usage: kiosk-audio.ts watch');
  process.exit(2);
}
