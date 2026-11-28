import { useCallback, useEffect, useRef, useState } from 'react';
import { debugLog } from '../utils/debugLog';
import { getDismissedUpdate, isRelease, piVersion, setDismissedUpdate } from '../utils/kiosk';
import type { PiVersion } from '../utils/kiosk';
import { checkImageUpdate, openUpdateStream } from '../utils/kioskService';
import type { ImageUpdateCheck } from '../utils/kioskService';

/** Give up following an update after this long; an install over a slow connection can take minutes. */
const GIVE_UP_MS = 20 * 60 * 1000;
/** The console keeps the newest lines only. */
const MAX_LINES = 500;
/** Logged by the Pi's updater (server/src/image-update.ts) as RAUC installs. */
const INSTALL_PROGRESS = /Update progress: (\d+)%/;
/** How long the percentage may stand still before the bar shows only that the install is still at work. */
export const STALLED_AFTER_MS = 8000;

/** The Pi's version, `<ref>+<commit>`, as the ref and commit the settings show. */
function parseVersion(value: string | null): PiVersion | null {
  const plus = value?.indexOf('+') ?? -1;
  return value && plus > 0 ? { ref: value.slice(0, plus), commit: value.slice(plus + 1, plus + 8) } : null;
}

/** How a version is named on screen: the release tag, or the branch and short commit. */
export function versionLabel(value: string): string {
  const version = parseVersion(value);
  if (!version) return value;
  return isRelease(version.ref) ? version.ref : `${version.ref} ${version.commit}`;
}

/** The newest version on the Pi's update channel, as its kiosk service tells it. */
type LatestVersion = { state: 'checking' } | { state: 'unknown' } | { state: 'known'; value: string };

/** The kiosk's software update: what it runs, whether a newer version is out, and how an update in progress is going. */
export interface KioskUpdate {
  version: PiVersion | null;
  release: boolean;
  /** "release", or the branch or tag the Pi is pinned to. */
  what: string | undefined;
  latest: LatestVersion;
  /** What is newer ("v1.13.0 is out"), or null when the Pi is up to date or it could not be told. */
  newer: string | null;
  isUpdating: boolean;
  /** What the update says it is doing, from the kiosk service; null until it has said anything. */
  progress: string | null;
  /** How far the install has got, in percent, for the progress bar; null until said. */
  percent: number | null;
  /**
   * The percentage has stood still for a while: the kiosk reports none while it copies the system image, the longest
   * step of an install, so the bar shows that it is still at work rather than how far it is.
   */
  isStalled: boolean;
  /** A version installed and waiting for a restart (`<ref>+<commit>`), or null. */
  installed: string | null;
  /** The newest version on the channel, when it failed to start here before and so is not installed. */
  failed: string | null;
  /** The newest lines of the update's output (the updater's journal), shown as they arrive. */
  output: string[];
  /** The full-screen console that follows an update: open from the moment one starts until it is closed. */
  consoleOpen: boolean;
  /** Whether to ask the person about the newer version: once for each version, not while one is under way. */
  prompting: boolean;
  /** True while the kiosk service is being asked what is newest. */
  isChecking: boolean;
  /** When the channel was last read (ms since the epoch), or null until it has been. */
  checkedAt: number | null;
  /**
   * Asks again what is newest (the settings do it every time they open). The last answer stays until the new one comes.
   * With `ask`, a newer version is asked about again even after "Not now": the person asked for it themselves.
   */
  checkNow: (ask?: boolean) => void;
  start: () => void;
  closeConsole: () => void;
  /** "Not now": the prompt stays away until a still newer version comes out. */
  dismissPrompt: () => void;
}

/**
 * Follows the Pi's software. Off the kiosk (`enabled` false) it does nothing. Starting an update (from the prompt or the
 * settings) opens the console, which writes every line the update prints to the debug console as well.
 */
export function useKioskUpdate(enabled: boolean): KioskUpdate {
  const [version] = useState(() => (enabled ? piVersion() : null));
  const [isUpdating, setIsUpdating] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  // The percentage that stood still for STALLED_AFTER_MS; it counts only while it is still the one shown.
  const [stalledAt, setStalledAt] = useState<number | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(getDismissedUpdate);
  // The kiosk service's answer to POST /update/check; null until it has given one.
  const [answer, setAnswer] = useState<ImageUpdateCheck | null>(null);

  // The connection that carries the update: opening it starts the update, and the kiosk sends the journal lines as they
  // are written. Closed when the page lets go of it, so no update outlives the hook's listening.
  const streamRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      streamRef.current?.();
    },
    []
  );

  useEffect(() => {
    if (!isUpdating || percent === null) return;
    const timer = setTimeout(() => {
      setStalledAt(percent);
    }, STALLED_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [isUpdating, percent]);

  // Gives up waiting for an update that never ends.
  useEffect(() => {
    if (!isUpdating) return;
    const timer = setTimeout(() => {
      streamRef.current?.();
      streamRef.current = null;
      setProgress('Stopped waiting for the update. It may still be running.');
      setIsUpdating(false);
    }, GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [isUpdating]);

  // Asked once at the start and again whenever checkNow is called. A newer check replaces one still under way, and an
  // answer that could not be had (the service or the internet unreachable) does not throw away an earlier one that could.
  const [check, setCheck] = useState({ id: 0, ask: false });
  const [answered, setAnswered] = useState(-1);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const checkNow = useCallback((ask = false) => setCheck(({ id }) => ({ id: id + 1, ask })), []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void checkImageUpdate(controller.signal).then(found => {
      if (controller.signal.aborted) return;
      setAnswer(previous => (found && (!previous || found.result !== 'unreachable') ? found : previous));
      if (found && found.result !== 'unreachable') setCheckedAt(Date.now());
      // Forgotten for this page only: "Not now" writes it down again.
      if (found && check.ask) setDismissed(null);
      setAnswered(check.id);
    });
    return () => controller.abort();
  }, [enabled, check]);

  const shown = (answer && parseVersion(answer.current)) ?? version;
  const release = Boolean(shown && isRelease(shown.ref));
  let latest: LatestVersion = { state: 'unknown' };
  if (answer && answer.result !== 'unreachable') {
    latest = { state: 'known', value: answer.latest ?? answer.current ?? '' };
  } else if (enabled && !answer && answered === -1) {
    latest = { state: 'checking' };
  }
  const offered = answer?.result === 'available' ? parseVersion(answer.latest) : null;
  let newer: string | null = null;
  if (offered) newer = release ? `${offered.ref} is out` : `${offered.ref} is now ${offered.commit}`;

  const start = useCallback(() => {
    streamRef.current?.();
    setProgress(null);
    setPercent(null);
    setStalledAt(null);
    setOutput([]);
    setIsUpdating(true);
    setConsoleOpen(true);
    let isOpen = false;
    let isEnded = false;
    let isRestarting = false;
    streamRef.current = openUpdateStream({
      onOpen: () => {
        isOpen = true;
      },
      onEvent: event => {
        if (event.type === 'status') {
          switch (event.state) {
            case 'installing': {
              setProgress('Installing the update…');
              break;
            }
            case 'installed': {
              isEnded = true;
              const installed = event.message ?? null;
              setProgress(`${installed ? versionLabel(installed) : 'The update'} is installed.`);
              setAnswer(previous => previous && { ...previous, installed, result: 'installed' });
              setIsUpdating(false);
              break;
            }
            case 'restarting': {
              isRestarting = true;
              setProgress('Restarting the kiosk…');
              break;
            }
            case 'done': {
              isEnded = true;
              setProgress(event.message ? `Update finished. ${event.message}` : 'Update finished.');
              setIsUpdating(false);
              break;
            }
            case 'failed': {
              isEnded = true;
              setProgress(`The update failed. ${event.message ?? ''}`.trim());
              setIsUpdating(false);
              break;
            }
            default:
          }
          return;
        }
        const counted = event.type === 'log' ? INSTALL_PROGRESS.exec(event.line) : null;
        if (counted) {
          // Drives the bar only: a line for every step would bury the output.
          setPercent(Number(counted[1]));
          return;
        }
        debugLog(event.type === 'error' ? 'error' : 'info', 'update', event.line);
        setOutput(lines => [...lines, event.line].slice(-MAX_LINES));
      },
      onClose: () => {
        streamRef.current = null;
        if (isEnded) return;
        // The restart ends the browser the page runs in, and with it this connection: the page is about to go.
        if (isRestarting) {
          setProgress('Restarting the kiosk…');
          return;
        }
        setProgress(isOpen ? 'Lost the connection to the kiosk.' : 'The kiosk service is not answering.');
        setIsUpdating(false);
      }
    });
  }, []);

  const newerId = latest.state === 'known' ? latest.value : null;
  const dismissPrompt = useCallback(() => {
    if (newerId === null) return;
    setDismissed(newerId);
    setDismissedUpdate(newerId);
  }, [newerId]);

  return {
    version: shown,
    release,
    what: release ? 'release' : shown?.ref,
    latest,
    newer,
    isUpdating,
    progress,
    percent,
    isStalled: isUpdating && percent !== null && stalledAt === percent,
    installed: answer?.installed ?? null,
    failed: answer?.result === 'failed' ? answer.latest : null,
    output,
    consoleOpen,
    prompting: newer !== null && newerId !== dismissed && !consoleOpen,
    isChecking: enabled && answered !== check.id,
    checkedAt,
    checkNow,
    start,
    closeConsole: () => setConsoleOpen(false),
    dismissPrompt
  };
}
