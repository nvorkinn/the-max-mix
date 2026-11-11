// The kiosk's local service for the app, on 127.0.0.1 only:
//   GET  /speakers          {"speakers": ["Kitchen", …]}   the AirPlay sinks PipeWire made, by the names routing uses
//                           plus {"volumes": {"Kitchen": 40, …}}, each speaker's volume in percent
//   POST /audio/route       {"speakers": [...]}            route the sound to those speakers (none: the Pi's own output)
//   POST /audio/volume      {"speaker": "Kitchen", "volume": 40}   set one speaker's volume (404: not on the network)
//   POST /sonos/play        {"room": "Kitchen", "uri": "spotify:track:…"}   play it on that Sonos room with sonoscli (sonos.ts):
//                           204, 400, or 502 {"error"}: why not, safe to show
//   POST /power/restart     restart the kiosk              POST /power/reboot    reboot the Pi
//   POST /display/wake      turn the screen back on        POST /wifi            show the Wi-Fi setup page
//   POST /heartbeat         the app (or the Wi-Fi setup page) is alive (watchdog.ts)  POST /log  {"level", "source", "message"}  an app error, to the journal
//   GET  /wifi/networks     {"networks": [{"ssid", "signal", "bars", "security"}, …]}   or 503 {"error"}: a safe message
//   POST /wifi/connect      {"ssid", "password", "hidden", "security"}   join a network: {"ok": true} or {"ok": false, "error"}
//   POST /wifi/phone        start Wi-Fi setup from a phone over Bluetooth for a few minutes (phone-setup.ts): {"ok": true}
//                           or 503 {"error"}. The page that shows the button is the only thing that can ask.
//   POST /wifi/hotspot      start a setup hotspot for a phone (hotspot.ts): {"ssid", "password", "url", "wifiQr", "urlQr"}
//                           or 503 {"error"}   POST /wifi/hotspot/stop  end it   GET /wifi/hotspot  {"state", "error"?}
//   POST /wifi/done         the setup page is finished (joined, or Cancel): close it
//   GET  /wifi-setup        the Wi-Fi setup page and its scripts (wifi-setup.ts)
//   GET  /lyrics?title=&artist=&duration=   {"source", "lrc"}: synced lyrics from NetEase, QQ Music or KuGou (lyrics.ts),
//                           the duration in ms is optional; 404: none found, 502: the sources could not be reached
//   GET  /bluetooth/devices   {"devices": [{"address", "name", "paired", "connected"}, …]}   the Bluetooth speakers BlueZ knows
//   POST /bluetooth/scan      look for speakers for a few seconds: the same answer      503 {"error"}: a safe message
//   POST /bluetooth/connect   {"address"}   pair (if needed), trust and connect: {"ok": true} or {"ok": false, "error"}
//   POST /bluetooth/remove    {"address"}   forget a speaker
//   WS   /power/update      pull the playbook now, restart the kiosk if that asks for it, and stream the journal of both
//                           (update-socket.ts)
// Only the app's origin is answered (CORS, and every POST and WebSocket is refused without its Origin header, so no other
// web page can trigger one). A request carries no command, only the name of one of the fixed actions in actions.ts.
// The Wi-Fi POSTs are for the Wi-Fi setup page this service serves itself (it has to work offline), so they answer
// its origin (LOCAL_ORIGIN) instead, and the app's origin cannot join a network.
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { perform } from './actions.ts';
import type { Action } from './actions.ts';
import { Bluetooth, BluetoothError, parseAddress } from './bluetooth.ts';
import type { BluetoothDevice, ConnectResult as BluetoothConnectResult } from './bluetooth.ts';
import { isLoopback, listenForHotspot } from './hotspot-portal.ts';
import { Hotspot, HotspotError } from './hotspot.ts';
import type { HotspotInfo, HotspotStatus } from './hotspot.ts';
import type { LyricsQuery } from './lyrics-sources.ts';
import { cached, findLyrics, parseLyricsQuery } from './lyrics.ts';
import type { LyricsHit } from './lyrics.ts';
import { parseConnectRequest } from './nmcli.ts';
import type { ConnectRequest, ConnectResult, Network } from './nmcli.ts';
import { PhoneSetup } from './phone-setup.ts';
import type { Graph } from './pipewire.ts';
import { parseSonosPlay, playOnSonos, SonosError } from './sonos.ts';
import type { SonosPlay } from './sonos.ts';
import { speakerSinks, validSpeakers, validVolume } from './speakers.ts';
import { attachUpdateSocket } from './update-socket.ts';
import type { Update } from './update-socket.ts';
import { runUpdate } from './update.ts';
import { chromiumPid, CHECK_MS, stopChromium, Watchdog } from './watchdog.ts';
import { wifiSetupAsset } from './wifi-setup.ts';
import type { Asset } from './wifi-setup.ts';

const SPEAKERS_PORT = 7341;
/** The origin of the pages this service serves itself (the Wi-Fi setup page). */
export const LOCAL_ORIGIN = `http://127.0.0.1:${SPEAKERS_PORT}`;
const MAX_BODY = 4096;
const MAX_MESSAGE = 2000;
/** At most this many app log lines a minute reach the journal, so a page stuck in an error loop cannot flood it. */
const LOGS_PER_MINUTE = 30;
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
  /** Sets a speaker's volume in percent; returns how many sinks it set (none: no speaker has that name). */
  setVolume: (speaker: string, volume: number) => Promise<number>;
  perform: (action: Action) => Promise<void>;
  /** Plays a Spotify item on a Sonos room; rejects with a SonosError when it could not. */
  sonos: (request: SonosPlay) => Promise<void>;
  heartbeat: () => void;
  log: (entry: AppLog) => void;
  wifi: Wifi;
  /** The setup page or one of its scripts for a GET of the URL, or null. */
  asset: (url: string) => Promise<Asset | null>;
  /** Synced lyrics for a song, or null; rejects when no source could be reached. */
  lyrics: (query: LyricsQuery) => Promise<LyricsHit | null>;
  bluetooth: BluetoothControl;
  phone: { start: () => Promise<void> };
  hotspot: {
    start: () => Promise<HotspotInfo>;
    stop: () => Promise<void>;
    status: () => HotspotStatus;
    /** Answers a request that came in over the hotspot. */
    handlePortal: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  };
}

/** BlueZ, for the Bluetooth speakers (bluetooth.ts). */
interface BluetoothControl {
  list: () => Promise<BluetoothDevice[]>;
  scan: () => Promise<BluetoothDevice[]>;
  connect: (address: string) => Promise<BluetoothConnectResult>;
  remove: (address: string) => Promise<void>;
}

/** NetworkManager, for the Wi-Fi setup page (nmcli.ts). */
interface Wifi {
  scan: () => Promise<Network[]>;
  connect: (request: ConnectRequest) => Promise<ConnectResult>;
  /** Closes the setup page (stops the Chromium that shows it); does not wait for that. */
  done: () => void;
}

/** An error the app reported, for the journal. */
export interface AppLog {
  level: 'error' | 'warn';
  source: string;
  message: string;
}

/** The body of POST /log as an entry (cut to a sensible length), or null when it is not one. */
export function parseAppLog(value: unknown): AppLog | null {
  if (typeof value !== 'object' || value === null) return null;
  const { level, source, message } = value as Record<string, unknown>;
  if (typeof message !== 'string' || (level !== 'error' && level !== 'warn')) return null;
  return {
    level,
    source: typeof source === 'string' ? source.replaceAll(/[^\w.-]/g, '').slice(0, 40) : '',
    // One journal line per entry: a stack trace's lines are joined.
    message: message
      .slice(0, MAX_MESSAGE)
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .join(' | ')
  };
}

/** Writes app log entries to the journal (this service's stderr), at most LOGS_PER_MINUTE a minute. */
export function journalLog(
  write: (line: string) => void = line => {
    console.error(line);
  },
  now = () => Date.now()
) {
  let windowStart = 0;
  let written = 0;
  let dropped = 0;
  return (entry: AppLog): void => {
    if (now() - windowStart >= 60_000) {
      if (dropped > 0) write(`app: ${dropped} more log lines were dropped`);
      windowStart = now();
      written = 0;
      dropped = 0;
    }
    if (written >= LOGS_PER_MINUTE) {
      dropped += 1;
      return;
    }
    written += 1;
    const from = entry.source ? ` (${entry.source})` : '';
    write(`app ${entry.level}${from}: ${entry.message}`);
  };
}

/** The AirPlay (RAOP) sinks' names, sorted, once each. */
export const speakerNames = (graph: Graph): string[] =>
  [...new Set(speakerSinks(graph).map(node => node.description))].toSorted((a, b) => a.localeCompare(b));

/** Each AirPlay speaker's volume in percent, for the ones that report one. */
export function speakerVolumes(graph: Graph): Record<string, number> {
  const volumes: Record<string, number> = {};
  for (const node of speakerSinks(graph)) {
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

/** Handles the body of POST /log or /audio/route; false when it is not valid. */
async function wasAccepted(url: string, request: IncomingMessage, deps: Deps): Promise<boolean> {
  const body: unknown = JSON.parse(await readBody(request));
  if (url === '/log') {
    const entry = parseAppLog(body);
    if (entry) deps.log(entry);
    return entry !== null;
  }
  const speakers = validSpeakers((body as { speakers?: unknown } | null)?.speakers);
  if (speakers) await deps.route(speakers);
  return speakers !== null;
}

/** Sets one speaker's volume from the body of POST /audio/volume; the status to answer with. */
async function volumeStatus(request: IncomingMessage, deps: Deps): Promise<number> {
  const body = validVolume(JSON.parse(await readBody(request)) as unknown);
  if (!body) return 400;
  return (await deps.setVolume(body.speaker, body.volume)) === 0 ? 404 : 204;
}

/** POST /sonos/play: plays the song on the room, or says why not. */
async function postSonos(request: IncomingMessage, response: ServerResponse, deps: Deps): Promise<void> {
  const body = parseSonosPlay(JSON.parse(await readBody(request)) as unknown);
  if (!body) {
    response.writeHead(400).end();
    return;
  }
  try {
    await deps.sonos(body);
    response.writeHead(204).end();
  } catch (error) {
    sendJson(response, 502, { error: error instanceof SonosError ? error.message : 'Sonos did not start playing.' });
  }
}

/** Sends the Bluetooth speakers (or the safe message of why not) as JSON. */
async function sendDevices(response: ServerResponse, devices: () => Promise<BluetoothDevice[]>): Promise<void> {
  try {
    sendJson(response, 200, { devices: await devices() });
  } catch (error) {
    sendJson(response, 503, { error: error instanceof BluetoothError ? error.message : 'Bluetooth failed.' });
  }
}

async function postBluetooth(
  url: string,
  request: IncomingMessage,
  response: ServerResponse,
  bluetooth: BluetoothControl
): Promise<void> {
  if (url === '/bluetooth/scan') {
    await sendDevices(response, () => bluetooth.scan());
    return;
  }
  const body = JSON.parse(await readBody(request)) as { address?: unknown } | null;
  const address = parseAddress(body?.address);
  if (!address) {
    response.writeHead(400).end();
  } else if (url === '/bluetooth/remove') {
    try {
      await bluetooth.remove(address);
    } catch (error) {
      // The speaker stays in the app's list, which is how a failed forget shows.
      console.warn(`bluetooth: remove failed: ${String(error)}`);
    }
    response.writeHead(204).end();
  } else {
    try {
      sendJson(response, 200, await bluetooth.connect(address));
    } catch (error) {
      sendJson(response, 200, {
        ok: false,
        error: error instanceof BluetoothError ? error.message : 'Bluetooth failed.'
      });
    }
  }
}

async function post(request: IncomingMessage, response: ServerResponse, deps: Deps): Promise<void> {
  const url = request.url ?? '';
  const action = POST_ACTIONS[url];
  let status = 204;
  switch (url) {
    case '/heartbeat': {
      deps.heartbeat();
      break;
    }
    case '/log':
    case '/audio/route': {
      if (!(await wasAccepted(url, request, deps))) status = 400;
      break;
    }
    case '/audio/volume': {
      status = await volumeStatus(request, deps);
      break;
    }
    case '/sonos/play': {
      await postSonos(request, response, deps);
      return;
    }
    case '/bluetooth/scan':
    case '/bluetooth/connect':
    case '/bluetooth/remove': {
      await postBluetooth(url, request, response, deps.bluetooth);
      return;
    }
    default: {
      if (action) await deps.perform(action);
      else status = 404;
    }
  }
  response.writeHead(status).end();
}

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
};

async function listNetworks(response: ServerResponse, wifi: Wifi): Promise<void> {
  try {
    sendJson(response, 200, { networks: await wifi.scan() });
  } catch (error) {
    // nmcli.ts rejects with a message that is safe to show.
    sendJson(response, 503, { error: error instanceof Error ? error.message : String(error) });
  }
}

/** GET /lyrics: the app's origin only, since each request makes the Pi call out to the lyrics sources. */
async function getLyrics(
  request: IncomingMessage,
  response: ServerResponse,
  origin: string,
  deps: Deps
): Promise<void> {
  const query = parseLyricsQuery(new URL(request.url ?? '', LOCAL_ORIGIN).searchParams);
  if (request.headers.origin !== origin) {
    response.writeHead(403).end();
  } else if (query) {
    try {
      const hit = await deps.lyrics(query);
      if (hit) sendJson(response, 200, hit);
      else response.writeHead(404).end();
    } catch {
      response.writeHead(502).end();
    }
  } else {
    response.writeHead(400).end();
  }
}

/** An error with the messages of its causes after it, so the journal says why and not only what failed. */
function describeError(error: unknown): string {
  const messages: string[] = [];
  let current = error;
  while (current instanceof Error && messages.length < 5) {
    messages.push(current.message);
    current = current.cause;
  }
  if (typeof current === 'string') messages.push(current);
  return messages.join(': ');
}

async function postWifi(request: IncomingMessage, response: ServerResponse, deps: Deps): Promise<void> {
  const { wifi } = deps;
  if (request.headers.origin !== LOCAL_ORIGIN) {
    response.writeHead(403).end();
    return;
  }
  if (request.url === '/wifi/phone') {
    try {
      await deps.phone.start();
      sendJson(response, 200, { ok: true });
    } catch (error) {
      console.warn(`wifi: phone setup did not start: ${describeError(error)}`);
      sendJson(response, 503, { error: 'Bluetooth is not available, so the phone cannot be used.' });
    }
    return;
  }
  if (request.url === '/wifi/hotspot') {
    try {
      sendJson(response, 200, await deps.hotspot.start());
    } catch (error) {
      console.warn(`wifi: hotspot did not start: ${describeError(error)}`);
      const message = error instanceof HotspotError ? error.message : 'The hotspot could not be started.';
      sendJson(response, 503, { error: message });
    }
    return;
  }
  if (request.url === '/wifi/hotspot/stop') {
    await deps.hotspot.stop();
    response.writeHead(204).end();
    return;
  }
  if (request.url === '/wifi/done') {
    response.writeHead(204).end();
    wifi.done();
    return;
  }
  const body = parseConnectRequest(JSON.parse(await readBody(request)) as unknown);
  if (body) sendJson(response, 200, await wifi.connect(body));
  else response.writeHead(400).end();
}

async function get(url: string, response: ServerResponse, deps: Deps): Promise<void> {
  switch (url) {
    case '/speakers': {
      const graph = await deps.graph();
      sendJson(response, 200, { speakers: speakerNames(graph), volumes: speakerVolumes(graph) });

      break;
    }
    case '/wifi/networks': {
      await listNetworks(response, deps.wifi);

      break;
    }
    case '/wifi/hotspot': {
      sendJson(response, 200, deps.hotspot.status());

      break;
    }
    default: {
      const asset = await deps.asset(url);
      if (asset) response.writeHead(200, { 'Content-Type': asset.type }).end(asset.body);
      else response.writeHead(404).end();
    }
  }
}

/** The GETs that answer the app's origin only (they make the Pi call out), and the rest (get). */
async function handleGet(
  request: IncomingMessage,
  response: ServerResponse,
  origin: string,
  deps: Deps
): Promise<void> {
  const url = request.url ?? '';
  if (url === '/bluetooth/devices') {
    if (request.headers.origin === origin) await sendDevices(response, () => deps.bluetooth.list());
    else response.writeHead(403).end();
  } else if (url.startsWith('/lyrics?')) {
    await getLyrics(request, response, origin, deps);
  } else {
    await get(url, response, deps);
  }
}

export function handleRequest(origin: string, deps: Deps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    // A request that did not come in on this machine's own address came over the setup hotspot, whose password anyone
    // nearby may be given: it gets the setup page and nothing of the kiosk's own requests, whatever its Origin says.
    if (!isLoopback(request.socket.localAddress)) {
      await deps.hotspot.handlePortal(request, response);
      return;
    }
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // Chromium asks before a public page reads from this machine (Private Network Access).
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
    response.setHeader('Cache-Control', 'no-store');
    try {
      if (request.method === 'OPTIONS') {
        response.writeHead(204).end();
      } else if (request.method === 'GET') {
        await handleGet(request, response, origin, deps);
      } else if (
        request.method === 'POST' &&
        ['/wifi/connect', '/wifi/done', '/wifi/phone', '/wifi/hotspot', '/wifi/hotspot/stop'].includes(
          request.url ?? ''
        )
      ) {
        await postWifi(request, response, deps);
      } else if (request.method === 'POST') {
        // The Wi-Fi setup page runs in the kiosk's Chromium too, and sends heartbeats so the watchdog leaves it alone.
        const isHeartbeat = request.url === '/heartbeat' && request.headers.origin === LOCAL_ORIGIN;
        if (isHeartbeat || request.headers.origin === origin) await post(request, response, deps);
        else response.writeHead(403).end();
      } else {
        response.writeHead(404).end();
      }
    } catch (error) {
      response.writeHead(503, { 'Content-Type': 'text/plain' }).end(String(error));
    }
  };
}

export function serveSpeakers(
  origin: string,
  deps: Pick<Deps, 'graph' | 'route' | 'setVolume' | 'wifi'>,
  update: Update = runUpdate
): Server {
  const watchdog = new Watchdog({
    now: () => Date.now(),
    chromiumPid: () => chromiumPid(),
    stop: pid => stopChromium(pid),
    log: message => {
      console.warn(message);
    }
  });
  const check = async () => {
    try {
      await watchdog.check();
    } catch (error) {
      console.warn(String(error));
    }
  };
  setInterval(() => void check(), CHECK_MS);
  const heartbeat = () => {
    watchdog.beat();
  };
  const handler = handleRequest(origin, {
    ...deps,
    perform,
    sonos: request => playOnSonos(request),
    heartbeat,
    log: journalLog(),
    asset: wifiSetupAsset,
    lyrics: cached(query => findLyrics(query)),
    bluetooth: new Bluetooth(),
    phone: new PhoneSetup({
      connect: request => deps.wifi.connect(request),
      done: () => {
        deps.wifi.done();
      }
    }),
    hotspot: new Hotspot({
      listen: host => listenForHotspot(server, host),
      scan: () => deps.wifi.scan(),
      connect: request => deps.wifi.connect(request),
      done: () => {
        deps.wifi.done();
      }
    })
  });
  const server = createServer((request, response) => void handler(request, response));
  attachUpdateSocket(server, origin, update);
  return server.listen(SPEAKERS_PORT, '127.0.0.1');
}
