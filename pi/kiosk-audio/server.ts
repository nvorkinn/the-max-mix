// The kiosk's local service for the app, on 127.0.0.1 only:
//   GET  /speakers          {"speakers": ["Kitchen", …]}   the AirPlay and Bluetooth sinks PipeWire made, by name,
//                           plus {"volumes": {"Kitchen": 40, …}}, each speaker's volume in percent, and
//                           {"outputs": [{"id", "name", "kind", "address"?, "volume", "linked"}, …]}: each sink by its
//                           PipeWire node name, "airplay" or "bluetooth", a Bluetooth speaker's address, its volume in
//                           percent or null, and whether the browser's sound goes to it now (speakers.ts)
//   POST /audio/route       {"outputs": [id, …]}           route the sound to those outputs (none: the Pi's own output);
//                           {"speakers": [name, …]} still works
//   POST /audio/volume      {"output": id, "volume": 40}   set one output's volume (404: not on the network);
//                           {"speaker": name, …} still works
//   Sonos (sonos.ts), with rooms by name; a failure answers 502 {"error"}: why, safe to show. The app's origin only, since each makes the Pi talk to the speakers.
//   GET  /sonos/groups      {"groups": [{"id", "rooms": [{"id", "name"}, …]}, …], "ms"}: the groups on the home network,
//                           the leading room first, and how long finding them took
//   GET  /sonos/now?room=   {"playing", "positionMs", "track": {"name", "artist", "album", "durationMs", "uri", "art"} or
//                           null, "next": [{"name", "artist", "uri"}, …] (at most 20 songs queued after it), "volume",
//                           "canSeek"}: what the room's group plays
//   GET  /sonos/art?room=   the current song's artwork from the room's group (the speaker serves it over plain HTTP), or 404
//   POST /sonos/play        {"room", "uri": "spotify:track:…", "next"?: ["spotify:track:…", …], "positionMs"?}   play it
//                           on the room's group, the songs in `next` (at most 50) queued after it, from positionMs into it;
//                           "queueFrom"?: a room, whose group's songs still to come are queued instead of `next`
//   POST /sonos/control     {"room", "action": "play" | "pause" | "next" | "previous" | "seek", "positionMs"?}
//   POST /sonos/volume      {"room", "volume": 0-100}   the room's whole group
//   POST /sonos/join        {"room", "to"}   add the room to the group `to` is in      POST /sonos/leave  {"room"}
//   POST /sonos/move        {"room", "from", "to", "name"}   move the song at place `from` in "next" (from 0) to place
//                           `to` in the group's Sonos queue, if it is still the song called `name`
//   GET  /sonos/events      server-sent events while the app listens: data {"kind": "groups"} when rooms join or leave,
//                           {"kind": "now"} when what a group plays (or its volume) changes (sonos-events.ts)
//   GET  /wifi/status       {"ssid": "Home", "address": "192.168.1.42"}: the network the Wi-Fi is on and the Pi's IPv4
//                           address on it, each or null (the app's origin only)
//   GET  /wifi/networks     {"networks": [{"ssid", "signal", "bars", "security"}, …]}   or 503 {"error"}: a safe message
//   POST /wifi/connect      {"ssid", "password", "hidden", "security"}   join a network: {"ok": true} or {"ok": false, "error"};
//                           once joined, the Pi forgets every other saved network, so it keeps only the one it is on
//   GET  /wifi/saved        {"networks": ["Home"]}: the network the Pi keeps, to join again (the app's origin only)
//   POST /wifi/forget       {"ssid"}   delete the Pi's saved connections to a network: {"ok": true} or {"ok": false, "error"}
//   POST /wifi/hotspot      start a setup hotspot for a phone (hotspot.ts): {"ssid", "password", "url", "wifiQr", "urlQr"}
//                           or 503 {"error"}   POST /wifi/hotspot/stop  end it
//                           GET /wifi/hotspot  {"state": "idle" | "running" | "connected" | "joining" | "joined" | "failed", "error"?,
//                           "ssid"? (the network being joined)}
//   GET  /lyrics?title=&artist=&duration=   lyrics from LRCLIB, Musixmatch, NetEase, QQ Music or KuGou (lyrics.ts):
//                           {"source"} and "lrc" (synced, timed word by word when a source has that), "plain" (text
//                           only) or "instrumental": true; the duration in ms is optional;
//                           404: none found, 502: the sources could not be reached
//   GET  /bluetooth/devices   {"devices": [{"address", "name", "paired", "connected"}, …]}   the Bluetooth speakers BlueZ knows
//   POST /bluetooth/scan      look for speakers for a few seconds: the same answer      503 {"error"}: a safe message
//   POST /bluetooth/connect   {"address"}   pair (if needed), trust and connect: {"ok": true} or {"ok": false, "error"}
//   POST /bluetooth/remove    {"address"}   forget a speaker, or a phone "Pair my phone" paired
//   GET  /bluetooth/monitor   for the debug console (bluetooth-monitor.ts): {"adapter", "devices": the paired ones,
//                             "nearby": unpaired devices heard in the last minute, "verbose",
//                             "log": [{"id", "time", "message"}], "pairing", "phones": [{"address", "name",
//                             "isHere", "lastSeen"}] (presence.ts), "presenceChecking": whether a watch began so
//                             lately that a phone not heard yet may still be heard}, or 503 {"error"}
//   POST /bluetooth/monitor   {"verbose": true}: log unpaired devices too
//   POST /bluetooth/presence  {"watch": true}: listen for the saved phones for two minutes (the person switcher is
//                             open), {"watch": false}: stop
//   POST /bluetooth/pair-phone   look for phones for two minutes so one can be picked and paired (phone-pairing.ts): 204,
//                                or 503 {"error"}; its progress is "pairing" in GET /bluetooth/monitor: {"state": "idle" |
//                                "scanning" | "pairing" | "paired" | "failed", "secondsLeft"?, "nearby"?: [{"address",
//                                "name"}], "name"?, "code"?, "isConfirmed"?, "phone"?: {"address", "name"}, "error"?}
//   POST /bluetooth/pair-phone/pick   {"address"} of a phone in "nearby": pair with it: 204, or 409 {"error"}
//   POST /bluetooth/pair-phone/stop   stop looking
//   POST /display/brightness   {"percent": 1-100, "fade"?: true}   set the screen's backlight, fading to it over 1.5 s
//                           with "fade" (backlight.ts): 204, or 404 for a screen with none (GET /screen says which: "brightness_control")
//   WS   /power/update      pull the playbook now, restart the kiosk if that asks for it, and stream the journal of both
//                           (update-socket.ts)
//   WS   /soloist           Spotify Soloist's events, and the app's commands to it (soloist-socket.ts)
// Only the app's origin is answered (CORS, and every POST and WebSocket is refused without its Origin header, so no other
// web page can trigger one). A request carries no command, only the name of one of the fixed actions in actions.ts.
// The Wi-Fi requests are for the app's Settings > Wi-Fi, which opens by itself when the kiosk starts with no network: the
// app works offline because this service serves it. The POSTs that change the network answer only that copy
// (LOCAL_ORIGIN), never a hosted app.
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { perform } from './actions.ts';
import type { Action } from './actions.ts';
import { APP_HEADERS, appFiles } from './app-files.ts';
import type { AppFile } from './app-files.ts';
import { FADE_MS, setBrightness, validBrightness, isFadeAsked } from './backlight.ts';
import { BluetoothMonitor, UNAVAILABLE as BLUETOOTH_UNAVAILABLE } from './bluetooth-monitor.ts';
import type { MonitorSnapshot } from './bluetooth-monitor.ts';
import { Bluetooth, BluetoothError, parseAddress } from './bluetooth.ts';
import type { BluetoothDevice, ConnectResult as BluetoothConnectResult } from './bluetooth.ts';
import { handoverFile, MAX_HANDOVER, parseHandover } from './handover.ts';
import type { HandoverStore } from './handover.ts';
import { isLoopback, listenForHotspot } from './hotspot-portal.ts';
import { Hotspot, HotspotError } from './hotspot.ts';
import type { HotspotInfo, HotspotStatus } from './hotspot.ts';
import type { LyricsQuery } from './lyrics-sources.ts';
import { cached, findLyrics, parseLyricsQuery } from './lyrics.ts';
import type { LyricsHit } from './lyrics.ts';
import { parseConnectRequest, parseForgetRequest } from './nmcli.ts';
import type { ConnectRequest, ConnectResult, Network } from './nmcli.ts';
import { discoverPhones, nameKiosk } from './phone-discovery.ts';
import { forgetPhone, PhonePairing, readPhones, savePhone } from './phone-pairing.ts';
import type { PairingStatus } from './phone-pairing.ts';
import type { Choice, Graph } from './pipewire.ts';
import { Presence, scanLe } from './presence.ts';
import type { PresenceStatus } from './presence.ts';
import { screenInfo } from './screen.ts';
import type { ScreenInfo } from './screen.ts';
import { SOLOIST_PATH, SoloistBridge } from './soloist-socket.ts';
import { storeSoloistKey, validSoloistKey } from './soloist.ts';
import { SonosEventHub } from './sonos-events.ts';
import type { SonosChange } from './sonos-events.ts';
import { libraryEvents } from './sonos-library.ts';
import { parseRoom, parseSonosRequest, runSonosRequest, sonos, SonosError } from './sonos.ts';
import type { SonosOperations, SonosRequest } from './sonos.ts';
import { speakerOutputs, speakerSinks, validChoices, validVolume } from './speakers.ts';
import { attachUpdateSocket } from './update-socket.ts';
import type { Update } from './update-socket.ts';
import { runUpdate } from './update.ts';
import { chromiumPid, CHECK_MS, stopChromium, Watchdog } from './watchdog.ts';

const SPEAKERS_PORT = 7341;
/** This service's own origin, which is the app's when the service serves it (kiosk_app_origin). */
export const LOCAL_ORIGIN = `http://127.0.0.1:${SPEAKERS_PORT}`;
const MAX_BODY = 4096;
/** How long POST /bluetooth/pair-phone/pick waits to hear that a pick was refused before answering 204. */
const PICK_ANSWER_MS = 500;
const MAX_MESSAGE = 2000;
/** At most this many app log lines a minute reach the journal, so a page stuck in an error loop cannot flood it. */
const LOGS_PER_MINUTE = 30;
const POST_ACTIONS: Record<string, Action> = {
  '/power/restart': 'restart',
  '/power/reboot': 'reboot',
  '/display/wake': 'wake',
  '/browser/forget-sign-ins': 'forget-sign-ins'
};

/** What the service needs: PipeWire's graph, routing, and a way to run an action; tests pass fakes. */
export interface Deps {
  graph: () => Promise<Graph>;
  route: (choices: Choice[]) => Promise<void>;
  /** Sets an output's volume in percent; returns how many sinks it set (none: no such output). */
  setVolume: (target: Choice, volume: number) => Promise<number>;
  perform: (action: Action) => Promise<void>;
  /** Carries out a POST /sonos/… request; rejects with a SonosError when it could not. */
  sonos: (request: SonosRequest) => Promise<void>;
  /** The Sonos calls, for the GETs; each rejects with a SonosError. */
  sonosCalls: SonosOperations;
  /** The speakers' live changes, for GET /sonos/events. */
  sonosEvents: { add: (client: (change: SonosChange) => void) => () => void };
  /** Milliseconds, to time how long finding the Sonos groups takes. */
  now?: () => number;
  heartbeat: () => void;
  log: (entry: AppLog) => void;
  wifi: Wifi;
  /** The app's saved data on its way from the hosted app to the local copy (handover.ts). */
  handover: HandoverStore;
  /** The web app installed on the Pi (app-files.ts): the file a GET of the URL asks for, or null. */
  app: (url: string) => Promise<AppFile | null>;
  /** Lyrics for a song, or null; rejects when no source could be reached. */
  lyrics: (query: LyricsQuery) => Promise<LyricsHit | null>;
  bluetooth: BluetoothControl;
  /** What BlueZ reports, for the debug console. */
  bluetoothMonitor: { snapshot: () => Promise<MonitorSnapshot>; setVerbose: (isVerbose: boolean) => void };
  /** Pairing a person's phone, for the pairing sheet and the debug console. */
  phonePairing: {
    start: () => Promise<void>;
    pick: (address: string) => Promise<void>;
    stop: () => Promise<void>;
    status: () => PairingStatus;
    forget: (address: string) => Promise<void>;
  };
  /** Whether each saved phone is nearby, for the person switcher and the debug console. */
  presence: { status: () => Promise<PresenceStatus>; watch: () => void; unwatch: () => void };
  /** The screen's size and whether its brightness can be set, for registering with countdown-server; null for none. */
  screen: () => Promise<ScreenInfo | null>;
  /** Sets the screen's backlight, in percent; returns how many backlights it set (none: the screen has none). */
  /** Sets the backlight in percent, fading to it when asked; returns how many it set (none: no backlight). */
  setBrightness: (percent: number, isFaded: boolean) => Promise<number>;
  /** Stores Spotify Soloist's API key and restarts the player (soloist.ts); rejects when it could not. */
  soloistKey: (key: string) => Promise<'stored' | 'unchanged'>;
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

/** NetworkManager, for the app's Settings > Wi-Fi (nmcli.ts). */
interface Wifi {
  scan: () => Promise<Network[]>;
  /** The name of the network the Wi-Fi is on, or null. */
  current: () => Promise<string | null>;
  /** The Pi's IPv4 address on its network, or null. */
  address: () => string | null;
  connect: (request: ConnectRequest) => Promise<ConnectResult>;
  /** The names of the networks the Pi keeps (after a join, only the one it is on). */
  saved: () => Promise<string[]>;
  /** Deletes the Pi's saved connections to a network. */
  forget: (ssid: string) => Promise<ConnectResult>;
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

/** The speaker sinks' names, sorted, once each. */
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

async function readBody(request: IncomingMessage, maxSize = MAX_BODY): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxSize) throw new RangeError('The request is too large');
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
  const choices = validChoices(body);
  if (choices) await deps.route(choices);
  return choices !== null;
}

/** Sets one output's volume from the body of POST /audio/volume; the status to answer with. */
/** POST /bluetooth/presence: starts or stops listening for the saved phones; the status to answer with. */
async function presenceStatus(request: IncomingMessage, deps: Deps): Promise<number> {
  const body = JSON.parse(await readBody(request)) as { watch?: unknown } | null;
  if (body?.watch === true) deps.presence.watch();
  else if (body?.watch === false) deps.presence.unwatch();
  else return 400;
  return 204;
}

/** POST /soloist/key: stores the API key countdown-server gave the app for the Soloist player. */
async function postSoloistKey(request: IncomingMessage, response: ServerResponse, deps: Deps): Promise<void> {
  const key = validSoloistKey(JSON.parse(await readBody(request)));
  if (key === null) {
    response.writeHead(400).end();
    return;
  }
  try {
    sendJson(response, 200, { state: await deps.soloistKey(key) });
  } catch (error) {
    // Its words never carry the key (soloist.ts).
    console.warn(String(error));
    sendJson(response, 503, { error: error instanceof Error ? error.message : 'Soloist failed.' });
  }
}

/** Sets the screen's backlight from the body of POST /display/brightness; the status to answer with. */
async function brightnessStatus(request: IncomingMessage, deps: Deps): Promise<number> {
  const body = JSON.parse(await readBody(request)) as unknown;
  const percent = validBrightness(body);
  if (percent === null) return 400;
  return (await deps.setBrightness(percent, isFadeAsked(body))) === 0 ? 404 : 204;
}

async function volumeStatus(request: IncomingMessage, deps: Deps): Promise<number> {
  const body = validVolume(JSON.parse(await readBody(request)) as unknown);
  if (!body) return 400;
  return (await deps.setVolume(body.target, body.volume)) === 0 ? 404 : 204;
}

/** A Sonos failure as 502 {"error"}: its safe message, or a plain one. */
function sendSonosError(response: ServerResponse, error: unknown): void {
  sendJson(response, 502, { error: error instanceof SonosError ? error.message : 'Sonos did not do that.' });
}

/** POST /sonos/<kind>: carries out the request on the room, or says why not. */
async function postSonos(request: IncomingMessage, response: ServerResponse, deps: Deps): Promise<void> {
  const value = JSON.parse(await readBody(request)) as unknown;
  const sonosRequest = parseSonosRequest((request.url ?? '').slice('/sonos/'.length), value);
  if (!sonosRequest) {
    response.writeHead(400).end();
    return;
  }
  try {
    await deps.sonos(sonosRequest);
    response.writeHead(204).end();
  } catch (error) {
    sendSonosError(response, error);
  }
}

/** A comment line this often keeps the event stream from looking idle. */
const KEEP_ALIVE_MS = 25_000;

/** GET /sonos/events: sends each Sonos change as a server-sent event until the app goes away. */
function streamSonosEvents(request: IncomingMessage, response: ServerResponse, deps: Deps): void {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.write(': listening\n\n');
  const stop = deps.sonosEvents.add(change => {
    response.write(`data: ${JSON.stringify({ kind: change })}\n\n`);
  });
  const keepAlive = setInterval(() => {
    response.write(': still here\n\n');
  }, KEEP_ALIVE_MS);
  request.on('close', () => {
    clearInterval(keepAlive);
    stop();
  });
}

/** GET /sonos/groups, /sonos/now and /sonos/art. */
async function getSonos(request: IncomingMessage, response: ServerResponse, deps: Deps): Promise<void> {
  const url = new URL(request.url ?? '', LOCAL_ORIGIN);
  const room = parseRoom(url.searchParams.get('room'));
  const isGroups = url.pathname === '/sonos/groups';
  if (!isGroups && !room) {
    response.writeHead(400).end();
    return;
  }
  const way = deps.sonosCalls;
  const now = deps.now ?? (() => performance.now());
  try {
    if (isGroups) {
      const started = now();
      const groups = await way.groups();
      sendJson(response, 200, { groups, ms: Math.round(now() - started) });
    } else if (url.pathname === '/sonos/now') {
      sendJson(response, 200, await way.now(room ?? ''));
    } else {
      const art = await way.art(room ?? '');
      if (art) response.writeHead(200, { 'Content-Type': art.type }).end(art.body);
      else response.writeHead(404).end();
    }
  } catch (error) {
    sendSonosError(response, error);
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

/** GET /bluetooth/monitor: what BlueZ reports, or 503 when it is not there. */
async function sendMonitor(response: ServerResponse, deps: Deps): Promise<void> {
  try {
    const snapshot = await deps.bluetoothMonitor.snapshot();
    const presence = await deps.presence.status();
    sendJson(response, 200, {
      ...snapshot,
      pairing: deps.phonePairing.status(),
      phones: presence.phones,
      presenceChecking: presence.isChecking
    });
  } catch {
    sendJson(response, 503, { error: BLUETOOTH_UNAVAILABLE });
  }
}

async function postBluetooth(
  url: string,
  request: IncomingMessage,
  response: ServerResponse,
  { bluetooth, phonePairing }: Pick<Deps, 'bluetooth' | 'phonePairing'>
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
      await phonePairing.forget(address);
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

/** What went wrong with `work`, or null when it went fine. */
async function refusalOf(work: Promise<void>): Promise<string | null> {
  try {
    await work;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Bluetooth failed.';
  }
}

/**
 * POST /bluetooth/pair-phone/pick: answered once the pick is taken (or refused). The pairing itself waits for the phone
 * and shows in the status.
 */
async function postPick(
  request: IncomingMessage,
  response: ServerResponse,
  phonePairing: Deps['phonePairing']
): Promise<void> {
  const address = parseAddress((JSON.parse(await readBody(request)) as { address?: unknown } | null)?.address);
  if (!address) {
    response.writeHead(400).end();
    return;
  }
  const refused = await Promise.race([
    refusalOf(phonePairing.pick(address)),
    new Promise<null>(resolve => {
      setTimeout(() => {
        resolve(null);
      }, PICK_ANSWER_MS);
    })
  ]);
  if (refused) sendJson(response, 409, { error: refused });
  else response.writeHead(204).end();
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
    case '/display/brightness': {
      status = await brightnessStatus(request, deps);
      break;
    }
    case '/soloist/key': {
      await postSoloistKey(request, response, deps);
      return;
    }
    case '/sonos/play':
    case '/sonos/control':
    case '/sonos/volume':
    case '/sonos/join':
    case '/sonos/leave':
    case '/sonos/move': {
      await postSonos(request, response, deps);
      return;
    }
    case '/bluetooth/monitor': {
      const body = JSON.parse(await readBody(request)) as { verbose?: unknown } | null;
      if (typeof body?.verbose === 'boolean') deps.bluetoothMonitor.setVerbose(body.verbose);
      else status = 400;
      break;
    }
    case '/bluetooth/presence': {
      status = await presenceStatus(request, deps);
      break;
    }
    case '/bluetooth/pair-phone': {
      try {
        await deps.phonePairing.start();
      } catch (error) {
        sendJson(response, 503, { error: error instanceof Error ? error.message : 'Bluetooth failed.' });
        return;
      }
      break;
    }
    case '/bluetooth/pair-phone/pick': {
      await postPick(request, response, deps.phonePairing);
      return;
    }
    case '/bluetooth/pair-phone/stop': {
      await deps.phonePairing.stop();
      break;
    }
    case '/bluetooth/scan':
    case '/bluetooth/connect':
    case '/bluetooth/remove': {
      await postBluetooth(url, request, response, deps);
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
  if (!isFromApp(request, origin)) {
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

/** POST /wifi/connect: joins the network, or null for a bad request. */
const joinWifi = (body: unknown, wifi: Wifi): Promise<ConnectResult> | null => {
  const join = parseConnectRequest(body);
  return join ? wifi.connect(join) : null;
};

/** POST /wifi/forget: forgets the network, or null for a bad request. */
const forgetWifi = (body: unknown, wifi: Wifi): Promise<ConnectResult> | null => {
  const ssid = parseForgetRequest(body);
  return ssid === null ? null : wifi.forget(ssid);
};

/** The Wi-Fi POSTs: the app's origin only, since each changes the network or the radio. */
async function postWifi(request: IncomingMessage, response: ServerResponse, origin: string, deps: Deps): Promise<void> {
  const { wifi } = deps;
  // Only the copy of the app this service serves changes the network, never a page from elsewhere, so a hosted app
  // origin (kiosk_app_origin before the move to the Pi) cannot.
  if (origin !== LOCAL_ORIGIN || request.headers.origin !== LOCAL_ORIGIN) {
    response.writeHead(403).end();
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
  const body = JSON.parse(await readBody(request)) as unknown;
  const answer = request.url === '/wifi/forget' ? forgetWifi(body, wifi) : joinWifi(body, wifi);
  const result = await answer;
  if (result) sendJson(response, 200, result);
  else response.writeHead(400).end();
}

async function get(url: string, response: ServerResponse, deps: Deps, isApp: boolean): Promise<void> {
  switch (url) {
    case '/wifi/status': {
      // The name of the home network is for the app's settings, not for any page that asks.
      if (isApp) sendJson(response, 200, { ssid: await deps.wifi.current(), address: deps.wifi.address() });
      else response.writeHead(403).end();

      break;
    }
    case '/wifi/saved': {
      // Like the network it is on, the networks the Pi keeps are for the app's settings only.
      if (isApp) sendJson(response, 200, { networks: await deps.wifi.saved() });
      else response.writeHead(403).end();

      break;
    }
    case '/speakers': {
      const graph = await deps.graph();
      sendJson(response, 200, {
        speakers: speakerNames(graph),
        volumes: speakerVolumes(graph),
        outputs: speakerOutputs(graph)
      });

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
    case '/screen': {
      const screen = await deps.screen();
      if (screen) sendJson(response, 200, screen);
      else response.writeHead(503).end();

      break;
    }
    default: {
      const file = await deps.app(url);
      if (file) {
        response
          .writeHead(200, { ...APP_HEADERS, 'Content-Type': file.type, 'Cache-Control': file.cache })
          .end(file.body);
      } else {
        response.writeHead(404).end();
      }
    }
  }
}

/**
 * Whether the request came from a page on the app's origin. A cross-origin request names its origin; when the app is the
 * copy this service serves itself (LOCAL_ORIGIN), its GETs are same-origin, and Chromium sends no Origin with those, only
 * Sec-Fetch-Site, which no page can set.
 */
export function isFromApp(request: IncomingMessage, origin: string): boolean {
  return request.headers.origin === undefined
    ? origin === LOCAL_ORIGIN && request.headers['sec-fetch-site'] === 'same-origin'
    : request.headers.origin === origin;
}

/**
 * The handover (handover.ts). Only the hosted app may hand its data over (POST /handover), and only the local copy may
 * take it (GET /handover) and have it deleted (POST /handover/done).
 */
async function handleHandover(
  request: IncomingMessage,
  response: ServerResponse,
  origin: string,
  store: HandoverStore
): Promise<void> {
  const isLocal = origin === LOCAL_ORIGIN && isFromApp(request, origin);
  if (request.method === 'POST' && request.url === '/handover') {
    if (origin === LOCAL_ORIGIN || request.headers.origin !== origin) {
      response.writeHead(403).end();
      return;
    }
    const handover = parseHandover(JSON.parse(await readBody(request, MAX_HANDOVER)) as unknown);
    if (handover) await store.save(handover);
    response.writeHead(handover ? 204 : 400).end();
  } else if (!isLocal) {
    response.writeHead(403).end();
  } else if (request.method === 'GET') {
    const handover = await store.read();
    if (handover) sendJson(response, 200, { items: handover });
    else response.writeHead(404).end();
  } else {
    await store.remove();
    response.writeHead(204).end();
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
  if (url.startsWith('/lyrics?')) {
    await getLyrics(request, response, origin, deps);
    return;
  }
  const appOnly = appOnlyGet(url, request, response, deps);
  if (!appOnly) await get(url, response, deps, isFromApp(request, origin));
  else if (isFromApp(request, origin)) await appOnly();
  else response.writeHead(403).end();
}

/** The GETs only the app's origin may make, as the work that answers one; null for any other URL. */
function appOnlyGet(
  url: string,
  request: IncomingMessage,
  response: ServerResponse,
  deps: Deps
): (() => Promise<void>) | null {
  if (url === '/bluetooth/devices') return () => sendDevices(response, () => deps.bluetooth.list());
  if (url === '/bluetooth/monitor') return () => sendMonitor(response, deps);
  // Following the speakers opens a listening port on the home network, so only the app may ask.
  if (url === '/sonos/events') {
    return () => {
      streamSonosEvents(request, response, deps);
      return Promise.resolve();
    };
  }
  // Each makes the Pi talk to the speakers on the home network, so only the app may ask.
  if (/^\/sonos\/(groups|now|art)(\?|$)/.test(url)) return () => getSonos(request, response, deps);
  return null;
}

export function handleRequest(origin: string, deps: Deps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    // A request that did not come in on this machine's own address came over the setup hotspot, whose password anyone
    // nearby may be given: it gets the hotspot's page (hotspot-portal.ts) and nothing of the kiosk's own requests, whatever its Origin says.
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
      } else if (
        (request.method === 'GET' && request.url === '/handover') ||
        (request.method === 'POST' && (request.url === '/handover' || request.url === '/handover/done'))
      ) {
        await handleHandover(request, response, origin, deps.handover);
      } else if (request.method === 'GET') {
        await handleGet(request, response, origin, deps);
      } else if (
        request.method === 'POST' &&
        ['/wifi/connect', '/wifi/forget', '/wifi/hotspot', '/wifi/hotspot/stop'].includes(request.url ?? '')
      ) {
        await postWifi(request, response, origin, deps);
      } else if (request.method === 'POST') {
        if (isFromApp(request, origin)) await post(request, response, deps);
        else response.writeHead(403).end();
      } else {
        response.writeHead(404).end();
      }
    } catch (error) {
      response.writeHead(503, { 'Content-Type': 'text/plain' }).end(String(error));
    }
  };
}

/** Names the kiosk THE MAX MIX in Bluetooth, trying again once 30 s later in case BlueZ was still starting. */
function nameKioskOnStart(monitor: { note: (message: string) => void }, retryMs = 30_000): void {
  const attempt = async (isLast: boolean) => {
    try {
      await nameKiosk();
      monitor.note('Bluetooth name: THE MAX MIX');
    } catch (error) {
      if (isLast) monitor.note(`Could not set the Bluetooth name: ${String(error)}`);
      else setTimeout(() => void attempt(true), retryMs);
    }
  };
  void attempt(false);
}

export function serveSpeakers(
  origin: string,
  deps: Pick<Deps, 'graph' | 'route' | 'setVolume' | 'wifi'> & {
    /** Where "Pair my phone" notes the phones it paired. */
    phonesFile: string;
    /** The web app's folder (KIOSK_APP_DIR), or '' for none. */
    appFolder: string;
    /** Where the hosted app's saved data waits for the local copy (handover.ts). */
    handoverFile: string;
    /** The Soloist player's state folder, and where the digest of the key stored there is noted (soloist.ts). */
    soloistStateDir: string;
    soloistDigestFile: string;
  },
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
  const bluetooth = new Bluetooth();
  const bluetoothMonitor = new BluetoothMonitor();
  nameKioskOnStart(bluetoothMonitor);
  const presence = new Presence({
    phones: () => readPhones(deps.phonesFile),
    devices: async () => (await bluetoothMonitor.snapshot()).devices,
    scan: signal => scanLe(signal),
    log: message => {
      bluetoothMonitor.note(message);
    }
  });
  const handler = handleRequest(origin, {
    ...deps,
    perform,
    sonos: request => runSonosRequest(request),
    sonosCalls: sonos,
    sonosEvents: new SonosEventHub(libraryEvents),
    heartbeat,
    log: journalLog(),
    app: appFiles(deps.appFolder),
    handover: handoverFile(deps.handoverFile),
    lyrics: cached(query => findLyrics(query)),
    bluetooth,
    bluetoothMonitor,
    presence,
    screen: () => screenInfo(),
    setBrightness: (percent, isFaded) => setBrightness(percent, undefined, isFaded ? FADE_MS : 0),
    soloistKey: key => storeSoloistKey(key, { stateDir: deps.soloistStateDir, digestFile: deps.soloistDigestFile }),
    phonePairing: new PhonePairing({
      discover: onCode => discoverPhones(onCode),
      nearby: () => bluetoothMonitor.nearbyNamed(),
      disconnect: address => bluetooth.disconnect(address),
      save: phone => savePhone(deps.phonesFile, phone),
      forget: address => forgetPhone(deps.phonesFile, address),
      log: message => {
        bluetoothMonitor.note(message);
      }
    }),
    hotspot: new Hotspot({
      listen: host => listenForHotspot(server, host),
      scan: () => deps.wifi.scan(),
      connect: request => deps.wifi.connect(request)
    })
  });
  const server = createServer((request, response) => void handler(request, response));
  const soloist = new SoloistBridge();
  attachUpdateSocket(server, origin, update, {
    [SOLOIST_PATH]: connection => {
      soloist.add(connection);
    }
  });
  return server.listen(SPEAKERS_PORT, '127.0.0.1');
}
