// The kiosk's own Spotify player: Spotify Soloist, the headless Spotify Connect player that the Pi's service runs for the
// active person (server/src/soloist.ts). The page reaches it through the service's WebSocket at /soloist
// (server/src/soloist-socket.ts), which passes Soloist's events on, only Soloist's commands back, and says with
// {"type": "bridge"} whether Soloist is there at all. While it is signed in, Soloist follows the account's playback
// whichever device plays and pushes every change as it happens; the app takes playback from these events alone.
// Soloist's commands act on the Spotify account's active device, whichever that is, so the control commands here are only sent while Soloist itself is the active device: otherwise a
// pause from the kiosk would stop the person's phone. They are refused rather than sent after an `activate`, which would
// take playback away from the phone; the app sends those through the Web API to the active device instead.

import type { RepeatMode, Track } from '../types';
import { KIOSK_SERVICE } from '../utils/kioskService';
import { getDevices } from './api';
import { isRecord, recordOf } from './parse';

/** The service's WebSocket that joins the page to Soloist (server/src/soloist-socket.ts). */
export const SOLOIST_SOCKET = `${KIOSK_SERVICE.replace(/^http/, 'ws')}/soloist`;
// Soloist answers a command within about 50 ms; one that has not answered by now is given up on, so one lost answer
// cannot leave the buttons dead.
const COMMAND_TIMEOUT_MS = 8000;
/** The service restarts with an update; the page connects again after this. */
export const RECONNECT_MS = 3000;
// Spotify lists a Connect device a moment after it signs in, so a lookup that does not find Soloist is tried again,
// waiting twice as long each time up to the longest wait.
const DEVICE_RETRY_MS = 3000;
const DEVICE_RETRY_MAX_MS = 60_000;
// Starting playback can raise Soloist's volume by one; a change of volume this soon after a start is put back.
const VOLUME_HOLD_MS = 5000;
// The commands that act on the account's active device. None is sent while Soloist is not it.
const CONTROL_COMMANDS = new Set([
  'play',
  'pause',
  'skip_next',
  'skip_prev',
  'seek',
  'set_volume',
  'set_shuffle',
  'set_repeat_context',
  'set_repeat_track',
  'add_to_queue'
]);
// Soloist names a new song at once or a moment later. One still without its name after this is asked for again, as the
// name does not always follow by itself.
export const DETAILS_WAIT_MS = 2000;
// Soloist's queue can briefly hold these stand-ins while it works out what comes next.
const PLACEHOLDER_PREFIX = 'spotify:meta:';
// Soloist's own queue_changed lists at most this many songs coming up; its answer to a get_queue without a limit lists
// them all, so a longer list can only be such an answer.
const PUSHED_QUEUE_MAX = 10;
const COVER_SIZES = ['xlarge', 'large', 'default', 'small'];
const REPEAT_MODES = new Set<unknown>(['off', 'context', 'track']);

/**
 * The account's playback as the kiosk's player reports it, whichever device plays; null while it is not signed in, or
 * while another device is the active one and no song is known yet.
 */
export type KioskPlaybackState = {
  /** Whether Soloist itself is the active device. */
  isActive: boolean;
  paused: boolean;
  position: number;
  duration?: number;
  shuffle?: boolean;
  repeat?: RepeatMode;
  /** Soloist's own volume, in percent: not that of another device that plays. */
  volume?: number;
  /** The song; only its id, uri and duration while its name and the rest have not arrived yet. */
  track?: Track;
} | null;

/** What the player tells its owner. */
export interface SoloistHandlers {
  /** Soloist is signed in and Spotify lists it, under this device id. */
  onReady: (deviceId: string) => void;
  /** Soloist went away (the service, Soloist itself, or its sign-in) after it was ready. */
  onNotReady: () => void;
  /** Soloist runs but nobody has signed it in: the person picks it in Spotify on their phone the first time. */
  onSignedOut: () => void;
  onState: (state: KioskPlaybackState) => void;
  /**
   * Whatever plays next changed. While Soloist is the active device this brings its whole queue, every song coming up;
   * null when it has no list to show (another device plays, or songs in it lack their details), and the queue has to be
   * read from the Web API instead.
   */
  onQueue: (upcoming: Track[] | null) => void;
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
const decorationsOf = (entity: unknown) => recordOf(recordOf(entity)['decorations']);
const nameOf = (entity: unknown): string | undefined => text(recordOf(decorationsOf(entity)['identity'])['name']);
const isGoing = (status: string) => status === 'playing' || status === 'buffering';
const uriOf = (entry: unknown): string => text(recordOf(recordOf(entry)['item'])['uri']) ?? '';
/** Where a cover's size comes in COVER_SIZES; an unknown size goes last. */
function coverRank(cover: Record<string, unknown>): number {
  const index = COVER_SIZES.indexOf(text(cover['size']) ?? '');
  return index === -1 ? COVER_SIZES.length : index;
}

function positionOf(value: unknown): Position | null {
  const record = recordOf(value);
  const position = finite(record['position_ms']);
  const timestamp = finite(record['timestamp_ms']);
  return position === undefined || timestamp === undefined
    ? null
    : { position_ms: position, timestamp_ms: timestamp, speed: finite(record['speed']) ?? 0 };
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
      return url === undefined ? [] : { url };
    });
  const artists = list(decorations['creators']).flatMap(creator => {
    const artist = nameOf(recordOf(creator)['entity']);
    return artist === undefined ? [] : { name: artist };
  });
  const track: Track = { id: uri.split(':').at(-1) ?? uri, uri, name, artists, album: { images } };
  const duration = finite(recordOf(decorations['playback'])['duration_ms']);
  if (duration !== undefined) track.duration_ms = duration;
  return track;
}

/** The song Soloist named, with its details once they arrived, or only its id while they have not. */
function nowPlaying(item: unknown): Track | undefined {
  const uri = text(recordOf(item)['uri']);
  if (!uri) return undefined;
  const duration = finite(recordOf(decorationsOf(item)['playback'])['duration_ms']);
  return (
    soloistTrack(item) ?? {
      id: uri.split(':').at(-1) ?? uri,
      uri,
      ...(duration !== undefined && { duration_ms: duration })
    }
  );
}

/** The songs of a queue Soloist sent, as the app's tracks; null when one of them has not got its details yet. */
function soloistQueue(upcoming: readonly unknown[]): Track[] | null {
  const tracks: Track[] = [];
  for (const entry of upcoming) {
    const track = soloistTrack(recordOf(entry)['item']);
    if (!track) return null;
    tracks.push(track);
  }
  return tracks;
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
  // The volume to set again once a start the page asked for plays, until when, and whether Soloist said it plays.
  #volumeOnStart: { volume: number; until: number; isPlaying: boolean } | null = null;
  // Running while a get_queue waits for its answer, which comes as a queue_changed of its own.
  #queueAsk: ReturnType<typeof setTimeout> | undefined;
  // The song whose details are waited for, or were asked for again (once a song), and the wait while it runs.
  #detailsFor: string | null = null;
  #detailsWait: ReturnType<typeof setTimeout> | undefined;

  constructor(handlers: SoloistHandlers, url = SOLOIST_SOCKET) {
    this.#handlers = handlers;
    this.#url = url;
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

  /**
   * Sends a command without waiting for its result: get_state and the like answer with events, not a result. A control
   * command is not sent while Soloist is not the active device; says whether it went.
   */
  #ask(command: string, fields?: Record<string, unknown>): boolean {
    if (!this.#isOpen || !this.#socket) return false;
    if (CONTROL_COMMANDS.has(command) && !this.#isActive) return false;
    this.#socket.send(JSON.stringify({ type: 'command', command, ...fields }));
    return true;
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
      if (!this.#ask(command, fields)) {
        this.#pending = this.#pending.filter(pending => pending.timer !== timer);
        clearTimeout(timer);
        reject(new Error('The kiosk player is not the active speaker.'));
      }
    });
  }

  /**
   * Asks Soloist for its whole queue: its own queue_changed lists only the first few songs. The answer is a queue_changed
   * too, which must not ask again, so a queue_changed that comes while one is asked for is taken as its answer.
   */
  #askQueue(): void {
    if (this.#queueAsk !== undefined) return;
    // Set before sending: the answer can come at once.
    this.#queueAsk = setTimeout(() => {
      this.#queueAsk = undefined;
    }, COMMAND_TIMEOUT_MS);
    if (!this.#ask('get_queue')) this.#forgetQueueAsk();
  }

  #forgetQueueAsk(): void {
    clearTimeout(this.#queueAsk);
    this.#queueAsk = undefined;
  }

  /**
   * A queue_changed: Soloist pushes one, trimmed, on every change, and answers a get_queue with one listing every song.
   * A pushed one asks for the whole list while Soloist is the active device; an answer is handed on.
   */
  #queueChanged(upcoming: unknown[]): void {
    const isAnswer = this.#queueAsk !== undefined || upcoming.length > PUSHED_QUEUE_MAX;
    if (isAnswer) this.#forgetQueueAsk();
    // A list with stand-ins is followed by the settled one.
    if (upcoming.some(entry => uriOf(entry).startsWith(PLACEHOLDER_PREFIX))) return;
    if (!this.#isActive || !this.#isLoggedIn) {
      // Soloist's queue is its own, not that of the device that plays: the app reads that one from the Web API.
      this.#handlers.onQueue(null);
      return;
    }
    if (isAnswer) this.#handlers.onQueue(soloistQueue(upcoming));
    else this.#askQueue();
  }

  /** Asks Soloist for its state again, once, when the song it named has not got its details after a moment. */
  #awaitDetails(): void {
    const uri = text(recordOf(this.#item)['uri']);
    if (!uri || soloistTrack(this.#item)) {
      this.#forgetDetails();
      return;
    }
    if (this.#detailsFor === uri) return;
    clearTimeout(this.#detailsWait);
    this.#detailsFor = uri;
    this.#detailsWait = setTimeout(() => {
      this.#detailsWait = undefined;
      this.#ask('get_state');
    }, DETAILS_WAIT_MS);
  }

  #forgetDetails(): void {
    clearTimeout(this.#detailsWait);
    this.#detailsWait = undefined;
    this.#detailsFor = null;
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
    this.#volumeOnStart = null;
    this.#forgetQueueAsk();
    this.#forgetDetails();
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
    if (wanted !== null && volume !== wanted && this.#isActive && Date.now() - this.#startedAt < VOLUME_HOLD_MS) {
      // A start the page asked for sets it again once it plays (#applyVolumeOnStart).
      if (this.#volumeOnStart) return;
      this.#startedAt = 0;
      this.#ask('set_volume', { volume: wanted });
      return;
    }
    this.#volume = volume;
  }

  /**
   * Once a start the page asked for plays (the first playback_changed to `playing` after it), the volume it had is set
   * again: Soloist can come up a step louder. A change that comes after that is put back too, for a while (#setVolume).
   */
  #applyVolumeOnStart(): void {
    const wanted = this.#volumeOnStart;
    if (!wanted) return;
    if (Date.now() > wanted.until) {
      this.#volumeOnStart = null;
      return;
    }
    if (!wanted.isPlaying || !this.#isActive) return;
    this.#volumeOnStart = null;
    this.#volume = wanted.volume;
    this.#startedAt = Date.now();
    this.#ask('set_volume', { volume: wanted.volume });
  }

  #state(): KioskPlaybackState {
    const track = nowPlaying(this.#item);
    if (!this.#isLoggedIn || (!track && !this.#isActive)) return null;
    const position = this.#position;
    const elapsed = position && position.speed > 0 ? (Date.now() - position.timestamp_ms) * position.speed : 0;
    const shuffle = this.#options['shuffle'];
    const repeat = this.#options['repeat'];
    return {
      isActive: this.#isActive,
      paused: !isGoing(this.#status),
      position: Math.max(0, (position?.position_ms ?? 0) + elapsed),
      ...(track && { track }),
      ...(track?.duration_ms !== undefined && { duration: track.duration_ms }),
      ...(typeof shuffle === 'boolean' && { shuffle }),
      ...(REPEAT_MODES.has(repeat) && { repeat: repeat as RepeatMode }),
      ...(this.#volume !== null && { volume: this.#volume })
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
    const wasActive = this.#isActive;
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
        if (!isLoggedIn) this.#handlers.onSignedOut();
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
        if (this.#volumeOnStart && message['status'] === 'playing') this.#volumeOnStart.isPlaying = true;
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
        this.#handlers.onState(this.#state());
        return;
      }
      case 'queue_changed': {
        this.#queueChanged(list(message['upcoming']));
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
    // On connecting, signing in or taking over playback, the queue is read whole once.
    if (!wasActive && this.#isActive && this.#isLoggedIn) this.#askQueue();
    this.#applyVolumeOnStart();
    this.#awaitDetails();
    this.#handlers.onState(this.#state());
  }

  /** The name Soloist goes by in Spotify Connect, as it reported it (the server picks one per kiosk), or null before. */
  get deviceName(): string | null {
    return this.#deviceName;
  }

  /** Whether Soloist is the account's active device, which is when its commands reach it. */
  get isActive(): boolean {
    return this.#isActive;
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
    this.#forgetQueueAsk();
    this.#forgetDetails();
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

  /**
   * Playback is about to start on Soloist at the page's asking (a play, or a move to it that plays): once it plays, the
   * volume it had is set again.
   */
  expectStart(): void {
    const volume = this.#volume;
    if (volume === null) return;
    this.#volumeOnStart = { volume, until: Date.now() + VOLUME_HOLD_MS, isPlaying: false };
  }

  async play(): Promise<void> {
    this.expectStart();
    try {
      await this.#control('play');
    } catch (error) {
      this.#volumeOnStart = null;
      throw error;
    }
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
    if (this.#volumeOnStart) this.#volumeOnStart.volume = volume;
    return this.#control('set_volume', { volume });
  }
}
