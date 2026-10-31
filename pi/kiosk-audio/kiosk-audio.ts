// The kiosk's audio routing (see README.md). Two commands, both run as the kiosk user, next to its PipeWire:
//   node kiosk-audio.ts open <kiosk-audio://route?speaker=…>   the link handler Chromium starts (kiosk-audio.desktop):
//                                                              saves the speakers and routes the sound to them at once
//   node kiosk-audio.ts watch                                  the background unit: every few seconds, routes any stream
//                                                              Chromium opened again and any chosen speaker that came back,
//                                                              and answers the app's speaker list on 127.0.0.1 (server.ts)
import { homedir } from 'node:os';
import path from 'node:path';
import { PipeWire } from './pipewire.ts';
import { serveSpeakers } from './server.ts';
import { loadSpeakers, parseLink, route, saveSpeakers } from './speakers.ts';

const WATCH_MS = 2000;
const stateHome = process.env['XDG_STATE_HOME'] || path.join(homedir(), '.local', 'state');
const stateFile = path.join(stateHome, 'the-max-mix', 'speakers.json');
const pipewire = new PipeWire();
const [command, link = ''] = process.argv.slice(2);

async function watchOnce(): Promise<void> {
  try {
    const speakers = await loadSpeakers(stateFile);
    // With no speakers chosen, PipeWire's own policy decides; the open command already handed the sound back.
    if (speakers.length > 0) await route(pipewire, speakers);
  } catch (error) {
    console.debug(String(error));
  }
}

if (command === 'open') {
  const speakers = parseLink(link);
  if (!speakers) {
    console.error('Expected kiosk-audio://route?speaker=<name>…');
    process.exit(2);
  }
  await saveSpeakers(stateFile, speakers);
  await route(pipewire, speakers);
} else if (command === 'watch') {
  setInterval(() => void watchOnce(), WATCH_MS);
  serveSpeakers(process.env['KIOSK_APP_ORIGIN'] ?? '', () => pipewire.graph());
} else {
  console.error('Usage: kiosk-audio.ts open <kiosk-audio://route?speaker=…> | watch');
  process.exit(2);
}
