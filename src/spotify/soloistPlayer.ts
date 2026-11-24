// The kiosk's own Spotify player: Spotify Soloist, the headless Spotify Connect player that the Pi's service runs for the
// active person (pi/kiosk-audio/soloist.ts). The page reaches it through the service's WebSocket at /soloist
// (pi/kiosk-audio/soloist-socket.ts), which passes Soloist's events on, only Soloist's commands back, and says with
// {"type": "bridge"} whether Soloist is there at all. Soloist's commands act on the Spotify account's active device,
// whichever that is, so the transport commands here are only sent while Soloist itself is the active device: otherwise a
// pause from the kiosk would stop the person's phone.

import type { RepeatMode, Track } from '../types';
import { KIOSK_SERVICE } from '../utils/kioskService';
import { getDevices } from './api';
import { isRecord, recordOf } from './parse';

const SOLOIST_SOCKET = `${KIOSK_SERVICE.replace(/^http/, 'ws')}/soloist`;
// Soloist answers a command within about 50 ms; one that has not answered by now is given up on, so one lost answer
// cannot leave the buttons dead.
const COMMAND_TIMEOUT_MS = 8000;
// The service restarts with an update; the page connects again after this.
const RECONNECT_MS = 3000;
// Spotify lists a Connect device a moment after it signs in, so a lookup that does not find Soloist is tried again,
// waiting twice as long each time up to the longest wait.
const DEVICE_RETRY_MS = 3000;
const DEVICE_RETRY_MAX_MS = 60_000;
// Starting playback can raise Soloist's volume by one; a change of volume this soon after a start is put back.
const VOLUME_HOLD_MS = 5000;
// Soloist's queue can briefly hold these stand-ins while it works out what comes next.
const PLACEHOLDER_PREFIX = 'spotify:meta:';
const COVER_SIZES = ['xlarge', 'large', 'default', 'small'];
const REPEAT_MODES = new Set<unknown>(['off', 'context', 'track']);

/** What the kiosk's player reports; null while it is not the account's active device. */
export type KioskPlaybackState = {
  paused: boolean;
  position: number;
  duration?: number;
  shuffle?: boolean;
  repeat?: RepeatMode;
  /** Missing while the song's details have not arrived yet. */
  track?: Track;
} | null;

/** What the player tells its owner. */
export interface SoloistHandlers {
  /** Soloist is signed in and Spotify lists it, under this device id. */
  onReady: (deviceId: string) => void;
  /** Soloist went away (the service, Soloist itself, or its sign-in) after it was ready. */
  onNotReady: () => void;
  onState: (state: KioskPlaybackState) => void;
  /** Whatever plays next changed. */
  onQueue: () => void;
}

interface Position {
  position_ms: number;
  timestamp_ms: number;
  speed: number;
}

interface PendingCommand {
  command: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const nameOf = (entity: unknown): string | undefined =>
  text(recordOf(recordOf(recordOf(entity)['decorations'])['identity'])['name']);
const isGoing = (status: string) => status === 'playing' || status === 'buffering';
/** Where a cover's size comes in COVER_SIZES; an unknown size goes last. */
function coverRank(cover: Record<string, unknown>): number {
  const index = COVER_SIZES.indexOf(text(cover['size']) ?? '');
  return index === -1 ? COVER_SIZES.length : index;
}

function positionOf(value: unknown): Position | null {
  const record = recordOf(value);
  const position = finite(record['position_ms']);
  const timestamp = finite(record['timestamp_ms']);
  if (position === undefined || timestamp === undefined) return null;
  return { position_ms: position, timestamp_ms: timestamp, speed: finite(record['speed']) ?? 0 };
}

/** A song as Soloist describes it, as the app's track; undefined until its details have arrived. */
export function soloistTrack(item: unknown): Track | undefined {
  const record = recordOf(item);
  const uri = text(record['uri']);
  const name = nameOf(record);
  if (!uri || name === undefined) return undefined;
  const decorations = recordOf(record['decorations']);
  const covers = list(recordOf(decorations['visual_identity'])['cover']).map(cover => recordOf(cover));
  // The largest first, as the Web API lists them: the artwork takes the first.
  const images = covers
    .toSorted((a, b) => coverRank(a) - coverRank(b))
    .flatMap(cover => {
      const url = text(cover['url']);
      return url === undefined ? [] : [{ url }];
    });
  const artists = list(decorations['creators']).flatMap(creator => {
    const artist = nameOf(recordOf(creator)['entity']);
    return artist === undefined ? [] : [{ name: artist }];
  });
  const track: Track = { id: uri.split(':').at(-1) ?? uri, uri, name, artists, album: { images } };
  const duration = finite(recordOf(decorations['playback'])['duration_ms']);
  if (duration !== undefined) track.duration_ms = duration;
  return track;
}

/** Connects to Soloist through the kiosk's service and keeps connecting while it is wanted. */
export class SoloistPlayer {
  readonly #handlers: SoloistHandlers;
  readonly #url: string;
  #socket: WebSocket | null = null;
  #isOpen = false;
  #isStopped = false;
  #reconnect: ReturnType<typeof setTimeout> | undefined;
  #pending: PendingCommand[] = [];
  // Soloist's own view of itself.
  #isLoggedIn = false;
  #isActive = false;
  #deviceName: string | null = null;
  // Its Spotify device id, once the Web API listed it.
  #deviceId: string | null = null;
  #lookup: ReturnType<typeof setTimeout> | undefined;
  #isLookingUp = false;
  #lookupWait = DEVICE_RETRY_MS;
  // The latest playback Soloist reported.
  #status = '';
  #item: unknown = null;
  #position: Position | null = null;
  #options: Record<string, unknown> = {};
  #volume: number | null = null;
  #startedAt = 0;

  constructor(handlers: SoloistHandlers, url = SOLOIST_SOCKET) {
    this.#handlers = handlers;
    this.#url = url;
  }

  /** Whether Soloist is the account's active device, which is when its commands reach it. */
  get isActive(): boolean {
    return this.#isActive;
  }

  #open(): void {
    this.#reconnect = undefined;
    const socket = new WebSocket(this.#url);
    this.#socket = socket;
    socket.addEventListener('open', () => {
      if (this.#socket === socket) this.#isOpen = true;
    });
    socket.addEventListener('message', message => {
      if (this.#socket === socket) this.#receive(message.data);
    });
    socket.addEventListener('close', () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#isOpen = false;
      this.#lost();
      if (!this.#isStopped) this.#reconnect = setTimeout(() => this.#open(), RECONNECT_MS);
    });
  }

  /** Starts connecting. */
  connect(): void {
    this.#isStopped = false;
    if (!this.#socket && this.#reconnect === undefined) this.#open();
  }

  /** Closes the connection for good; nothing is reported after this. */
  disconnect(): void {
    this.#isStopped = true;
    clearTimeout(this.#reconnect);
    this.#reconnect = undefined;
    clearTimeout(this.#lookup);
    const socket = this.#socket;
    this.#socket = null;
    this.#isOpen = false;
    this.#failPending('The kiosk player disconnected.');
    socket?.close();
  }

  /** Brings the state up to date: asks Soloist again, or connects at once when the connection is down. */
  refresh(): void {
    if (this.#isStopped) return;
    if (this.#socket) {
      this.#ask('get_state');
      return;
    }
    clearTimeout(this.#reconnect);
    this.#open();
  }

  /** Looks Soloist up in Spotify's device list again (its id went stale); resolves with its id, or null. */
  refreshDevice(): Promise<string | null> {
    clearTimeout(this.#lookup);
    this.#lookup = undefined;
    this.#deviceId = null;
    this.#lookupWait = DEVICE_RETRY_MS;
    return this.#findDevice();
  }

  play(): Promise<void> {
    return this.#control('play');
  }

  pause(): Promise<void> {
    return this.#control('pause');
  }

  nextTrack(): Promise<void> {
    return this.#control('skip_next');
  }

  previousTrack(): Promise<void> {
    return this.#control('skip_prev');
  }

  seek(positionMs: number): Promise<void> {
    return this.#control('seek', { position_ms: Math.max(0, Math.round(positionMs)) });
  }

  /** Sets the volume, in percent. */
  setVolume(percent: number): Promise<void> {
    const volume = Math.min(100, Math.max(0, Math.round(percent)));
    this.#volume = volume;
    return this.#control('set_volume', { volume });
  }

  /** Sends a command without waiting for its result: get_state and the like answer with events, not a result. */
  #ask(command: string, fields?: Record<string, unknown>): void {
    if (this.#isOpen) this.#socket?.send(JSON.stringify({ type: 'command', command, ...fields }));
  }

  /** Sends a transport command, only while Soloist is the active device, and resolves once Soloist took it. */
  async #control(command: string, fields?: Record<string, unknown>): Promise<void> {
    if (!this.#isOpen) throw new Error('The kiosk player is not connected.');
    if (!this.#isActive) throw new Error('The kiosk player is not the active speaker.');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending = this.#pending.filter(pending => pending.timer !== timer);
        reject(new Error('Spotify did not answer. Try again.'));
      }, COMMAND_TIMEOUT_MS);
      this.#pending.push({ command, resolve, reject, timer });
      this.#ask(command, fields);
    });
  }

  #failPending(message: string): void {
    for (const pending of this.#pending.splice(0)) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
  }

  #resolve(command: unknown): void {
    const index = this.#pending.findIndex(pending => pending.command === command);
    const [pending] = index === -1 ? [] : this.#pending.splice(index, 1);
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.resolve();
  }

  /** Soloist's errors do not name the command they answer, so an error is taken as the answer to the oldest one. */
  #reject(message: string): void {
    const pending = this.#pending.shift();
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.reject(new Error(message));
  }

  /** Soloist is gone, or cannot play: it is no longer the kiosk's device. */
  #lost(): void {
    const wasReady = this.#deviceId !== null;
    clearTimeout(this.#lookup);
    this.#lookup = undefined;
    this.#lookupWait = DEVICE_RETRY_MS;
    this.#deviceId = null;
    this.#isLoggedIn = false;
    this.#isActive = false;
    this.#status = '';
    this.#failPending('The kiosk player disconnected.');
    if (this.#isStopped) return;
    if (wasReady) this.#handlers.onNotReady();
    this.#handlers.onState(null);
  }

  async #findDevice(): Promise<string | null> {
    if (this.#isLookingUp || !this.#isLoggedIn || this.#deviceName === null) return this.#deviceId;
    this.#isLookingUp = true;
    const name = this.#deviceName;
    let found: string | null = null;
    try {
      const { devices } = await getDevices();
      found = devices.find(device => device.name === name)?.id ?? null;
    } catch {
      // Tried again below, like a list that does not hold it yet.
    } finally {
      this.#isLookingUp = false;
    }
    // Soloist went, or another one came, while Spotify answered.
    if (!this.#isStillFor(name)) return null;
    if (found === null) {
      clearTimeout(this.#lookup);
      this.#lookup = setTimeout(() => void this.#findDevice(), this.#lookupWait);
      this.#lookupWait = Math.min(DEVICE_RETRY_MAX_MS, this.#lookupWait * 2);
      return null;
    }
    this.#lookupWait = DEVICE_RETRY_MS;
    this.#deviceId = found;
    this.#handlers.onReady(found);
    return found;
  }

  /** Whether the player still wants the device of the signed-in Soloist called `name`. */
  #isStillFor(name: string): boolean {
    return !this.#isStopped && this.#isLoggedIn && this.#deviceName === name;
  }

  #setStatus(value: unknown): void {
    const status = text(value);
    if (status === undefined) return;
    // The first status after connecting is where playback already was, not a start.
    if (this.#status !== '' && !isGoing(this.#status) && isGoing(status)) this.#startedAt = Date.now();
    this.#status = status;
  }

  #setVolume(value: unknown): void {
    const volume = finite(value);
    if (volume === undefined) return;
    const wanted = this.#volume;
    // Starting playback can raise the volume by one: the volume it had is set again, once.
    if (this.#isActive && wanted !== null && volume !== wanted && Date.now() - this.#startedAt < VOLUME_HOLD_MS) {
      this.#startedAt = 0;
      this.#ask('set_volume', { volume: wanted });
      return;
    }
    this.#volume = volume;
  }

  #state(): KioskPlaybackState {
    if (!this.#isActive) return null;
    const position = this.#position;
    const elapsed = position && position.speed > 0 ? (Date.now() - position.timestamp_ms) * position.speed : 0;
    const track = soloistTrack(this.#item);
    const shuffle = this.#options['shuffle'];
    const repeat = this.#options['repeat'];
    return {
      paused: !isGoing(this.#status),
      position: Math.max(0, (position?.position_ms ?? 0) + elapsed),
      ...(track && { track }),
      ...(track?.duration_ms !== undefined && { duration: track.duration_ms }),
      ...(typeof shuffle === 'boolean' && { shuffle }),
      ...(REPEAT_MODES.has(repeat) && { repeat: repeat as RepeatMode })
    };
  }

  #setActive(value: unknown): void {
    if (typeof value === 'boolean') this.#isActive = value;
  }

  #receive(data: unknown): void {
    if (typeof data !== 'string') return;
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRecord(message) || this.#isStopped) return;
    switch (message['type']) {
      case 'bridge': {
        // Soloist greets a connection of its own with its state; one joined to the service's asks for it.
        if (message['connected'] === true) this.#ask('get_state');
        else this.#lost();
        return;
      }
      case 'auth_state': {
        const name = text(message['device_name']) ?? null;
        const isLoggedIn = message['logged_in'] === true;
        if (!isLoggedIn || (this.#deviceName !== null && name !== this.#deviceName)) this.#lost();
        this.#deviceName = name;
        this.#isLoggedIn = isLoggedIn;
        this.#setActive(message['is_active']);
        if (this.#isLoggedIn && this.#deviceId === null && this.#lookup === undefined) void this.#findDevice();
        break;
      }
      case 'device_changed': {
        this.#setActive(message['is_active']);
        break;
      }
      case 'playback_state': {
        this.#setActive(message['is_active']);
        this.#setStatus(message['status']);
        this.#item = message['item'];
        this.#position = positionOf(message['position']);
        this.#options = recordOf(message['options']);
        this.#setVolume(message['volume']);
        break;
      }
      case 'playback_changed': {
        this.#setStatus(message['status']);
        break;
      }
      case 'position_sync': {
        this.#position = positionOf(message['position']) ?? this.#position;
        break;
      }
      case 'track_changed': {
        this.#item = message['item'];
        break;
      }
      case 'options_changed': {
        this.#options = recordOf(message['options']);
        break;
      }
      case 'volume_changed': {
        this.#setVolume(message['volume']);
        return;
      }
      case 'queue_changed': {
        const upcoming = list(message['upcoming']);
        const isSettled = upcoming.every(
          entry => !(text(recordOf(recordOf(entry)['item'])['uri']) ?? '').startsWith(PLACEHOLDER_PREFIX)
        );
        if (isSettled) this.#handlers.onQueue();
        return;
      }
      case 'command_result': {
        this.#resolve(message['command']);
        return;
      }
      case 'error': {
        this.#reject(text(message['message']) ?? 'The kiosk player refused that.');
        return;
      }
      default: {
        return;
      }
    }
    this.#handlers.onState(this.#state());
  }
}
