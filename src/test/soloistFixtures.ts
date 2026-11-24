// Spotify Soloist's own messages, recorded on the Pi (e2e/fixtures/soloist): what it answered each command with, and a
// playback state, so the tests feed the player what the real one sends.
import commandsText from '../../e2e/fixtures/soloist/commands.jsonl?raw';
import nowText from '../../e2e/fixtures/soloist/now.json?raw';
import queueText from '../../e2e/fixtures/soloist/queue.json?raw';

type Message = Record<string, unknown>;

interface Recorded {
  conn: number;
  dir: 'sent' | 'received';
  message: unknown;
}

const recorded = commandsText
  .trim()
  .split('\n')
  .map(line => JSON.parse(line) as Recorded);

const isMessage = (value: unknown): value is Message => typeof value === 'object' && value !== null;

/** The name the recorded Soloist ran under. */
export const RECORDED_DEVICE_NAME = 'The Max Mix Probe';

/** A playback_state Soloist sent while it played a song with all its details, here as the active device or not. */
export function recordedNow(isActive: boolean): Message {
  return { ...(JSON.parse(nowText) as Message), is_active: isActive };
}

/** A queue_changed Soloist sent, with the songs coming up. */
export const recordedQueue = (): Message => JSON.parse(queueText) as Message;

/** Soloist's auth_state for a signed-in Soloist. */
export const authState = (isActive: boolean, deviceName = RECORDED_DEVICE_NAME): Message => ({
  type: 'auth_state',
  logged_in: true,
  is_active: isActive,
  device_name: deviceName
});

/**
 * What Soloist sent on the last recorded connection that began with `command`, in order: its greeting (an auth_state and
 * a playback_state), then its answer. The recording did these while Soloist was the active device.
 */
export function recordedReplies(command: string): Message[] {
  const first = new Map<number, unknown>();
  for (const entry of recorded) {
    if (entry.dir === 'sent' && !first.has(entry.conn)) first.set(entry.conn, entry.message);
  }
  const conn = [...first].findLast(([, message]) => isMessage(message) && message['command'] === command)?.[0];
  if (conn === undefined) throw new Error(`No recorded connection began with ${command}`);
  return recorded
    .filter(entry => entry.conn === conn && entry.dir === 'received')
    .map(entry => entry.message as Message);
}
