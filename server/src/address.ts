// The Pi's own address on its network, for the app's About page: someone looking for the kiosk on the network (to SSH
// in, say) needs it, and the screen is the one place it can be read without a keyboard.
import type { NetworkInterfaceInfo } from 'node:os';

/**
 * The IPv4 address of the Pi on its network, from os.networkInterfaces(): the Wi-Fi's first (wlan…), else a cable's
 * (eth… or en…), else any other that isn't the Pi's own loopback. Null when it has none.
 */
export function lanAddress(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string | null {
  const named = Object.entries(interfaces).flatMap(([name, infos]) =>
    (infos ?? [])
      .filter(info => info.family === 'IPv4' && !info.internal)
      .map(info => ({ name, address: info.address }))
  );
  const first = (wanted: RegExp) => named.find(({ name }) => wanted.test(name))?.address;
  return first(/^wl/) ?? first(/^(eth|en)/) ?? named[0]?.address ?? null;
}
