import { useCallback, useEffect, useRef, useState } from 'react';
import type { SetupReport, SetupStatus } from 'countdown-api';
import { sendSetupReport, setupStart, setupStatus } from '../countdown/registration';

/** How often the kiosk asks where its setup stands, so it shows the step the owner's phone is on. */
export const SETUP_POLL_MS = 2000;

/** The kiosk's setup as countdown-server follows it. */
export interface SetupFollowing {
  /**
   * Where the setup stands: undefined until the server has said, and null when the server doesn't follow setups (one
   * from before it did), so the kiosk goes by what it knows itself.
   */
  status: SetupStatus | null | undefined;
  /**
   * Tells the server something of the kiosk's own setup, again every couple of seconds until it has answered. Resolves
   * true once it has, and false at once when the server doesn't follow setups (or the hook is gone).
   */
  report: (report: SetupReport) => Promise<boolean>;
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Where the kiosk's setup stands on countdown-server, asked every couple of seconds while `isRunning` (the wizard is up
 * and the kiosk is on a network). A kiosk the server has no setup for sends its first report (setupStart), which also
 * tells a server that doesn't follow setups (it answers 404) from one that hasn't heard from this kiosk; the first then
 * isn't asked again.
 */
export function useSetupStatus(isRunning: boolean): SetupFollowing {
  const [status, setStatus] = useState<SetupStatus | null | undefined>();
  // Whether the server follows setups, as far as is known: null until it has said.
  const supportedRef = useRef<boolean | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const take = useCallback((answer: SetupStatus | 'unsupported') => {
    supportedRef.current = answer !== 'unsupported';
    const next = answer === 'unsupported' ? null : answer;
    // The same answer is the same state, so a step that hasn't changed draws nothing again.
    setStatus(current => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const controller = new AbortController();
    const { signal } = controller;
    // Read through a call, so each step sees whether it has been stopped while it waited.
    const stopped = () => signal.aborted;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async (): Promise<void> => {
      let answer: SetupStatus | 'unreported' | 'unsupported' | null = await setupStatus(signal);
      if (stopped()) return;
      if (answer === 'unreported') {
        answer = await sendSetupReport(await setupStart(), signal);
        if (stopped()) return;
      }
      if (answer !== null) take(answer);
      if (answer !== 'unsupported') timer = setTimeout(() => void ask(), SETUP_POLL_MS);
    };
    void ask();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [isRunning, take]);

  const report = useCallback(
    async (facts: SetupReport): Promise<boolean> => {
      // Read through a call, so each step sees whether the wizard has gone while it waited.
      const isGone = () => !mountedRef.current;
      while (!isGone() && supportedRef.current !== false) {
        // eslint-disable-next-line no-await-in-loop
        const answer = await sendSetupReport(facts);
        if (isGone()) break;
        if (answer !== null) {
          take(answer);
          return answer !== 'unsupported';
        }
        // eslint-disable-next-line no-await-in-loop
        await wait(SETUP_POLL_MS);
      }
      return false;
    },
    [take]
  );

  return { status, report };
}
