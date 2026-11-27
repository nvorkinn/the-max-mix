import { useEffect, useRef } from 'react';
import { peopleOnKiosk } from '../spotify/auth';
import type { PersonOnKiosk } from '../spotify/auth';
import { readBluetoothReport, watchPresence } from '../utils/bluetoothMonitor';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';
import { isSwitcherWatching, samePhone } from './useSavedPhones';
import type { SavedPhone } from './useSavedPhones';

/** How often the kiosk looks for who is home while the screen sleeps. */
const ASLEEP_CHECK_MS = 5 * 60_000;
/** How often a check re-reads what the Pi hears. */
const READ_STEP_MS = 1000;
/** The longest a check waits for the Pi to finish its first seconds of listening (server/src/presence.ts). */
const CHECK_LIMIT_MS = 15_000;

/**
 * Who to switch to: the one other signed-in person whose linked phone is heard, when the active person's linked phone
 * is not. Null when the active person has no phone linked (nothing tells they have gone), is heard, or when nobody
 * else or more than one other person is heard.
 */
export function whoToSwitchTo(people: PersonOnKiosk[], phones: SavedPhone[]): string | null {
  const isHeard = (address: string) => phones.some(phone => phone.isHere && samePhone(address, phone.address));
  const active = people.find(person => person.active);
  if (!active?.phoneAddress || isHeard(active.phoneAddress)) return null;
  const heard = people.filter(person => !person.active && person.signedIn && isHeard(person.phoneAddress));
  const [only, another] = heard;
  return another ? null : (only?.spotifyId ?? null);
}

/** Whether a check could switch at all, before asking the Pi to listen. */
function couldSwitch(people: PersonOnKiosk[]): boolean {
  const active = people.find(person => person.active);
  return (
    Boolean(active?.phoneAddress) && people.some(person => !person.active && person.signedIn && person.phoneAddress)
  );
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Has the Pi listen for the linked phones for its first few seconds and says whose phone it heard, or null when it
 * cannot say or the check is cut short (`isCancelled`, or the person switcher listening meanwhile, whose closing stops
 * the Pi listening). Stops early once the active person's phone is heard.
 */
async function listen(activeAddress: string, isCancelled: () => boolean): Promise<SavedPhone[] | null> {
  await watchPresence(true);
  try {
    const startedAt = Date.now();
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const report = await readBluetoothReport();
      if (isCancelled() || isSwitcherWatching()) return null;
      const activeHeard = report.phones.some(phone => phone.isHere && samePhone(activeAddress, phone.address));
      if (activeHeard || !report.presenceChecking) return report.phones;
      if (Date.now() - startedAt > CHECK_LIMIT_MS) return null;
      // eslint-disable-next-line no-await-in-loop
      await pause(READ_STEP_MS);
    }
  } finally {
    if (!isSwitcherWatching()) {
      await watchPresence(false).catch(() => {
        // It stops by itself after two minutes.
      });
    }
  }
}

/**
 * Switches to whoever is home when the screen has been left alone: when someone wakes it from dimmed or asleep, and
 * every ASLEEP_CHECK_MS while it sleeps. A check has the Pi listen for the linked phones for a few seconds, then stops
 * it, and switches (`onSwitch`) only as whoToSwitchTo says, never while music plays (`isPlaying`) or while `isBusy` (the
 * music search is open) when it ends. Does nothing when not `enabled` (off the kiosk).
 */
export function useAutoSwitch({
  enabled,
  asleep,
  dimmed,
  isPlaying,
  isBusy,
  onSwitch
}: Readonly<{
  enabled: boolean;
  asleep: boolean;
  dimmed: boolean;
  isPlaying: boolean;
  isBusy: boolean;
  onSwitch: (spotifyId: string, asleep: boolean) => void;
}>): void {
  const latestRef = useRef({ asleep, isPlaying, isBusy, onSwitch });
  useEffect(() => {
    latestRef.current = { asleep, isPlaying, isBusy, onSwitch };
  }, [asleep, isPlaying, isBusy, onSwitch]);
  const isRunningRef = useRef(false);
  const isMountedRef = useRef(true);
  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    []
  );
  const isCancelled = () => !isMountedRef.current;

  // A check that began asleep carries on when the screen wakes, and stands for the wake's own check.
  const checkRef = useRef(async (reason: string) => {
    const people = peopleOnKiosk();
    if (isRunningRef.current || latestRef.current.isPlaying || !couldSwitch(people)) return;
    isRunningRef.current = true;
    try {
      const active = people.find(person => person.active);
      const phones = await listen(active?.phoneAddress ?? '', isCancelled);
      if (!phones) return;
      const now = latestRef.current;
      const next = whoToSwitchTo(peopleOnKiosk(), phones);
      if (!next) {
        debugLog('info', 'presence', `${reason}: staying ${active?.name ?? ''}`);
      } else if (now.isPlaying || now.isBusy || isCancelled()) {
        debugLog('info', 'presence', `${reason}: not switching while in use`);
      } else {
        const name = people.find(person => person.spotifyId === next)?.name ?? next;
        debugLog('info', 'presence', `${reason}: switching to ${name}`);
        now.onSwitch(next, now.asleep);
      }
    } catch (error) {
      debugLog('warn', 'presence', `${reason}: ${errorMessage(error)}`);
    } finally {
      isRunningRef.current = false;
    }
  });

  // Woken from dimmed or asleep: someone is back, maybe not the person signed in.
  const wasIdleRef = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const isIdle = asleep || dimmed;
    if (!isIdle && wasIdleRef.current) void checkRef.current('Woken');
    wasIdleRef.current = isIdle;
  }, [enabled, asleep, dimmed]);

  // Asleep: every five minutes, until it wakes.
  useEffect(() => {
    if (!enabled || !asleep) return;
    const timer = setInterval(() => void checkRef.current('Asleep'), ASLEEP_CHECK_MS);
    return () => clearInterval(timer);
  }, [enabled, asleep]);
}
