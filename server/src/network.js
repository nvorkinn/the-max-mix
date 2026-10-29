import os from 'node:os';

/**
 * Retrieves the primary local LAN IPv4 address of the Raspberry Pi / Host machine
 */
export function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    const candidates = addresses ?? [];
    for (const iface of candidates) {
      // Skip internal (i.e. 127.0.0.1) and non-ipv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}
