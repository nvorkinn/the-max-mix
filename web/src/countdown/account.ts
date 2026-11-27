// What the kiosk's owner's account has linked, from countdown-server: GET /api/devices/account (countdown-api's
// getAccount), with the device secret. The links are the account's, not the kiosk's, so they aren't in its config, whose
// `parcels.enabled` is off both while parcels are switched off and while the account has no Parcel key. With this the
// Settings tab tells the two apart. Only whether each service is linked: no key or login ever comes here.

import type { DeviceAccount } from 'countdown-api';
import { getAccount } from '../../../vendor/countdown-api/src/countdown_api/client';
import type { Client } from '../../../vendor/countdown-api/src/countdown_api/client';
import { serverClient } from './config';

/**
 * The owner's account's links, or null when they can't be told: the kiosk isn't registered or owned, or the server
 * can't be reached, refuses, or is one from before it answered them.
 */
export async function fetchDeviceAccount(client: Client | null = serverClient()): Promise<DeviceAccount | null> {
  if (!client) return null;
  try {
    const { data } = await getAccount(client);
    return data ?? null;
  } catch {
    return null;
  }
}
