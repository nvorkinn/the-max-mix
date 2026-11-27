import { useEffect, useState } from 'react';
import { fetchDeviceAccount } from '../countdown/account';
import { serverClient } from '../countdown/config';

/**
 * How often the kiosk asks again while the account has no Parcel key, so the Parcels page goes from how to set Parcel
 * up to its settings soon after the owner pastes the key on their phone.
 */
export const PARCEL_LINK_POLL_MS = 5000;

/**
 * Whether the owner's account has a Parcel API key: true or false as countdown-server says, null when it can't be told
 * (the settings then show, as they did before the server said), and undefined until it has answered.
 */
export type ParcelLink = boolean | null | undefined;

/**
 * Whether the owner's account has a Parcel API key, asked of countdown-server when the page that uses it comes up, and
 * again every few seconds while it has none. `onLinked` is called when a key appears while the page is up, for the
 * config to be read again: its `parcels.enabled` was off for want of the key.
 */
export function useParcelLink(onLinked?: () => void): ParcelLink {
  // With no server to ask there is no answer to wait for.
  const [linked, setLinked] = useState<ParcelLink>(() => (serverClient() ? undefined : null));

  useEffect(() => {
    if (!serverClient()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unlinked = false;
    const ask = async () => {
      const account = await fetchDeviceAccount();
      if (stopped) return;
      if (account?.parcel.linked) {
        setLinked(true);
        if (unlinked) onLinked?.();
        return;
      }
      if (account) {
        unlinked = true;
        setLinked(false);
      } else if (!unlinked) {
        // Never answered, so it can't be told. Once it has said there's no key, a missed answer changes nothing.
        setLinked(null);
        return;
      }
      timer = setTimeout(() => void ask(), PARCEL_LINK_POLL_MS);
    };
    void ask();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [onLinked]);

  return linked;
}
