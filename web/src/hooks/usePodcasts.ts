import { useEffect, useState } from 'react';
import type { StoredPodcasts, TouchscreenConfig } from 'countdown-api';
import { fetchDeviceAccount } from '../countdown/account';
import { serverClient } from '../countdown/config';
import { fetchPodcasts } from '../podcasts/api';

/** How often the owner's NRK link is asked about again, and the shows read again while the tab is open. */
export const PODCASTS_POLL_MS = 5 * 60_000;

/**
 * Whether the kiosk has a Podcasts tab: its config has podcasts on (left out is on) and the owner's account has NRK
 * linked, which countdown-server is asked at start and every few minutes after. False with no owned config.
 */
export function usePodcastsTab(config: TouchscreenConfig | null): boolean {
  const enabled = config !== null && config.podcasts?.enabled !== false;
  const [linked, setLinked] = useState(false);
  useEffect(() => {
    if (!enabled || !serverClient()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      const account = await fetchDeviceAccount();
      if (stopped) return;
      // A missed answer keeps what was last said.
      if (account) setLinked(account.nrk.linked);
      timer = setTimeout(() => void ask(), PODCASTS_POLL_MS);
    };
    void ask();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled]);
  return enabled && linked;
}

/**
 * The shows the Podcasts tab lists, read from countdown-server when the tab opens and every few minutes while it is
 * open; null until the first answer. The last answer stays while the tab is closed.
 */
export function usePodcasts(open: boolean): StoredPodcasts | null {
  const [podcasts, setPodcasts] = useState<StoredPodcasts | null>(null);
  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      const answer = await fetchPodcasts();
      if (stopped) return;
      if (answer) setPodcasts(answer);
      timer = setTimeout(() => void read(), PODCASTS_POLL_MS);
    };
    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [open]);
  return podcasts;
}
