import { useCallback, useEffect, useRef, useState } from 'react';
import { debugLog } from '../utils/debugLog';
import {
  getDismissedUpdate,
  isRelease,
  latestCommit,
  latestRelease,
  piVersion,
  setDismissedUpdate
} from '../utils/kiosk';
import type { PiVersion } from '../utils/kiosk';
import { checkImageUpdate, openUpdateStream } from '../utils/kioskService';
import type { ImageUpdateCheck } from '../utils/kioskService';

/** Give up following an update after this long; a pull of a big release can take minutes. */
const GIVE_UP_MS = 20 * 60 * 1000;
/** The console keeps the newest lines only. */
const MAX_LINES = 500;
/** Printed by the playbook's callback plugin (ansible/callback_plugins/task_progress.py) as each task starts. */
const TASK_PROGRESS = /Ansible progress: (\d+)\/(\d+)\s*$/;
/** Logged by an image Pi's updater (pi/kiosk-audio/image-update.ts) as RAUC installs. */
const INSTALL_PROGRESS = /Update progress: (\d+)%/;

/** An image Pi's version, `<ref>+<commit>`, as the ref and commit the settings show. */
function imageVersion(value: string | null): PiVersion | null {
  const plus = value?.indexOf('+') ?? -1;
  return value && plus > 0 ? { ref: value.slice(0, plus), commit: value.slice(plus + 1, plus + 8) } : null;
}

/** How a version is named on screen: the release tag, or the branch and short commit. */
export function versionLabel(value: string): string {
  const version = imageVersion(value);
  if (!version) return value;
  return isRelease(version.ref) ? version.ref : `${version.ref} ${version.commit}`;
}

/** How many of the playbook's tasks have started so far, out of how many it knows about. */
interface TaskProgress {
  done: number;
  total: number;
}

/** The newest release tag on GitHub for a Pi on a release, otherwise the newest commit of the ref it is pinned to. */
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
  /** How far the playbook (or, on an image Pi, the install in percent) has got, for the progress bar; null until said. */
  tasks: TaskProgress | null;
  /** True on a Pi flashed with the A/B image: it installs updates itself and finishes them with a restart. */
  isImage: boolean;
  /** An image Pi's version installed and waiting for a restart (`<ref>+<commit>`), or null. */
  installed: string | null;
  /** The newest version on an image Pi's channel, when it failed to start here before and so is not installed. */
  failed: string | null;
  /** The newest lines of the update's output (the journal of the pull and the restart), shown as they arrive. */
  output: string[];
  /** The full-screen console that follows an update: open from the moment one starts until it is closed. */
  consoleOpen: boolean;
  /** Whether to ask the person about the newer version: once for each version, not while one is under way. */
  prompting: boolean;
  /** True while GitHub is being asked what is newest. */
  isChecking: boolean;
  /** When GitHub last told what is newest (ms since the epoch), or null until it has. */
  checkedAt: number | null;
  /**
   * Asks GitHub again what is newest (the settings do it every time they open). The last answer stays until the new one
   * comes. With `ask`, a newer version is asked about again even after "Not now": the person asked for it themselves.
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
  const [tasks, setTasks] = useState<TaskProgress | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [latest, setLatest] = useState<LatestVersion>({ state: version ? 'checking' : 'unknown' });
  const [dismissed, setDismissed] = useState(getDismissedUpdate);
  // An image Pi's answer to POST /update/check; null on a Pi Ansible installed, which keeps the GitHub check below.
  const [image, setImage] = useState<ImageUpdateCheck | null>(null);

  // The connection that carries the update: opening it starts the update, and the kiosk sends the journal lines as they
  // are written. Closed when the page lets go of it, so no update outlives the hook's listening.
  const streamRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      streamRef.current?.();
    },
    []
  );

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
  // answer that could not be had (offline, rate limited) does not throw away an earlier one that could.
  const [check, setCheck] = useState({ id: 0, ask: false });
  const [answered, setAnswered] = useState(-1);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const checkNow = useCallback((ask = false) => setCheck(({ id }) => ({ id: id + 1, ask })), []);
  useEffect(() => {
    if (!version) return;
    const controller = new AbortController();
    // A release that is not ready yet (its Release workflow is still running) is not offered: the Pi would not install
    // it. Until then the one the Pi runs counts as the newest.
    const latestValue = isRelease(version.ref)
      ? latestRelease(controller.signal).then(found => (found && !found.ready ? version.ref : (found?.tag ?? null)))
      : latestCommit(version.ref, controller.signal);
    void latestValue.then(value => {
      if (controller.signal.aborted) return;
      setLatest(previous => {
        if (value) return { state: 'known', value };
        return previous.state === 'known' ? previous : { state: 'unknown' };
      });
      // Forgotten for this page only: "Not now" writes it down again.
      if (check.ask) setDismissed(null);
      if (value) setCheckedAt(Date.now());
      setAnswered(check.id);
    });
    return () => controller.abort();
  }, [version, check]);

  // An image Pi answers for its own channel, at the same times. An answer that could not be had keeps the earlier one.
  const [imageAnswered, setImageAnswered] = useState(-1);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void checkImageUpdate(controller.signal).then(found => {
      if (controller.signal.aborted) return;
      setImage(previous => (found && (!previous || found.result !== 'unreachable') ? found : previous));
      if (found && found.result !== 'unreachable') setCheckedAt(Date.now());
      if (found && check.ask) setDismissed(null);
      setImageAnswered(check.id);
    });
    return () => controller.abort();
  }, [enabled, check]);

  const shown = image ? imageVersion(image.current) : version;
  const release = Boolean(shown && isRelease(shown.ref));
  let newer: string | null = null;
  let newest: LatestVersion = latest;
  if (image) {
    newest =
      image.result === 'unreachable'
        ? { state: 'unknown' }
        : { state: 'known', value: image.latest ?? image.current ?? '' };
    const offered = image.result === 'available' ? imageVersion(image.latest) : null;
    if (offered) newer = release ? `${offered.ref} is out` : `${offered.ref} is now ${offered.commit}`;
  } else if (version && latest.state === 'known') {
    if (release) newer = latest.value === version.ref ? null : `${latest.value} is out`;
    else newer = latest.value.startsWith(version.commit) ? null : `${version.ref} is now ${latest.value.slice(0, 7)}`;
  }

  const start = useCallback(() => {
    streamRef.current?.();
    setProgress(null);
    setTasks(null);
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
              setProgress(`${installed ? versionLabel(installed) : 'The update'} is installed. Restart to finish.`);
              setImage(previous => previous && { ...previous, installed, result: 'installed' });
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
        const counted = event.type === 'log' ? TASK_PROGRESS.exec(event.line) : null;
        if (counted) {
          // Drives the bar only: a line for every task would bury the output.
          setTasks({ done: Number(counted[1]), total: Number(counted[2]) });
          return;
        }
        const percent = event.type === 'log' ? INSTALL_PROGRESS.exec(event.line) : null;
        if (percent) {
          setTasks({ done: Number(percent[1]), total: 100 });
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

  const newerId = newest.state === 'known' ? newest.value : null;
  const dismissPrompt = useCallback(() => {
    if (newerId === null) return;
    setDismissed(newerId);
    setDismissedUpdate(newerId);
  }, [newerId]);

  return {
    version: shown,
    release,
    what: release ? 'release' : shown?.ref,
    latest: newest,
    newer,
    isUpdating,
    progress,
    tasks,
    isImage: image !== null,
    installed: image?.installed ?? null,
    failed: image?.result === 'failed' ? image.latest : null,
    output,
    consoleOpen,
    prompting: newer !== null && newerId !== dismissed && !consoleOpen,
    isChecking: image ? imageAnswered !== check.id : version !== null && answered !== check.id,
    checkedAt,
    checkNow,
    start,
    closeConsole: () => setConsoleOpen(false),
    dismissPrompt
  };
}
