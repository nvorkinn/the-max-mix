// Small helpers for talking to BlueZ over the system bus with dbus-native (phone-discovery.ts, presence.ts).
import type { MessageBus } from 'dbus-native';

const CONNECT_WAIT_MS = 5000;

/** Waits until the bus has said hello (it has a unique name), which BlueZ needs to call back. */
export async function untilConnected(bus: MessageBus): Promise<void> {
  const deadline = performance.now() + CONNECT_WAIT_MS;
  while (!bus.name) {
    if (performance.now() > deadline) throw new Error('The system bus did not answer.');
    // A short poll for the hello reply.
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/** Waits for `work` and ignores how it ended: used to take things down, which may already be gone. */
export async function ignoreFailure(work: PromiseLike<unknown>): Promise<void> {
  try {
    await work;
  } catch {
    // Already gone, or BlueZ stopped: nothing is left to undo.
  }
}
