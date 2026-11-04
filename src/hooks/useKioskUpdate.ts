import { useCallback, useEffect, useState } from 'react';
import { debugLog } from '../utils/debugLog';
import {
  getDismissedUpdate,
  isRelease,
  latestCommit,
  latestRelease,
  piVersion,
  setDismissedUpdate,
  updateKiosk
} from '../utils/kiosk';
import type { PiVersion } from '../utils/kiosk';
import { getUpdateStatus } from '../utils/kioskService';

const POLL_MS = 1500;
/** Give up following an update after this long; a pull of a big release can take minutes. */
const GIVE_UP_MS = 20 * 60 * 1000;

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
  /** The last lines the update has printed, shown as they arrive. */
  output: string[];
  /** The full-screen console that follows an update: open from the moment one starts until it is closed. */
  consoleOpen: boolean;
  /** Whether to ask the person about the newer version: once for each version, not while one is under way. */
  prompting: boolean;
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
  const [output, setOutput] = useState<string[]>([]);
  const [latest, setLatest] = useState<LatestVersion>({ state: version ? 'checking' : 'unknown' });
  const [dismissed, setDismissed] = useState(getDismissedUpdate);

  // While an update runs, follow it: show its latest line, and write every line to the debug console.
  useEffect(() => {
    if (!isUpdating) return;
    const started = Date.now();
    let logged = 0;
    let hasSeenRunning = false;
    let misses = 0;
    const timer = setInterval(() => {
      void getUpdateStatus().then(status => {
        if (!status) {
          misses += 1;
          // The service ends with the kiosk: after it was seen running, no answer means the kiosk is restarting.
          if (hasSeenRunning) setProgress('Restarting the kiosk…');
          else if (misses >= 5) setProgress('The kiosk service is not answering.');
          return;
        }
        misses = 0;
        // Nothing has started yet (any log is from an earlier pull), or the log began again.
        if (status.state === 'idle') return;
        if (status.total < logged) logged = 0;
        const count = Math.min(status.total - logged, status.lines.length);
        const fresh = count > 0 ? status.lines.slice(-count) : [];
        for (const line of fresh) debugLog('info', 'update', line);
        logged = status.total;
        const last = status.lines.at(-1);
        setOutput(status.lines);
        if (status.state === 'running') {
          hasSeenRunning = true;
        } else if (status.state === 'done') {
          setProgress('Update finished. Nothing needed a restart.');
          setIsUpdating(false);
        } else {
          setProgress(`The update failed. ${last ?? ''}`.trim());
          setIsUpdating(false);
        }
      });
      if (Date.now() - started > GIVE_UP_MS) {
        setProgress('Stopped waiting for the update. It may still be running.');
        setIsUpdating(false);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [isUpdating]);

  useEffect(() => {
    if (!version) return;
    const controller = new AbortController();
    const latestValue = isRelease(version.ref)
      ? latestRelease(controller.signal)
      : latestCommit(version.ref, controller.signal);
    void latestValue.then(value => {
      if (!controller.signal.aborted) setLatest(value ? { state: 'known', value } : { state: 'unknown' });
    });
    return () => controller.abort();
  }, [version]);

  const release = Boolean(version && isRelease(version.ref));
  let newer: string | null = null;
  if (version && latest.state === 'known') {
    if (release) newer = latest.value === version.ref ? null : `${latest.value} is out`;
    else newer = latest.value.startsWith(version.commit) ? null : `${version.ref} is now ${latest.value.slice(0, 7)}`;
  }

  const start = useCallback(() => {
    setProgress(null);
    setOutput([]);
    setIsUpdating(true);
    setConsoleOpen(true);
    updateKiosk();
  }, []);

  const newerId = latest.state === 'known' ? latest.value : null;
  const dismissPrompt = useCallback(() => {
    if (newerId === null) return;
    setDismissed(newerId);
    setDismissedUpdate(newerId);
  }, [newerId]);

  return {
    version,
    release,
    what: release ? 'release' : version?.ref,
    latest,
    newer,
    isUpdating,
    progress,
    output,
    consoleOpen,
    prompting: newer !== null && newerId !== dismissed && !consoleOpen,
    start,
    closeConsole: () => setConsoleOpen(false),
    dismissPrompt
  };
}
