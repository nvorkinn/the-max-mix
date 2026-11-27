/* eslint-disable sonarjs/no-hardcoded-ip -- the addresses a Pi's network interfaces might have, made up for the tests */
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { lanAddress } from './address.ts';

const ipv4 = (address: string, isInternal = false): NetworkInterfaceInfo => ({
  address,
  netmask: '255.255.255.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:00',
  internal: isInternal,
  cidr: `${address}/24`
});
const ipv6: NetworkInterfaceInfo = {
  address: 'fe80::1',
  netmask: 'ffff:ffff:ffff:ffff::',
  family: 'IPv6',
  mac: '00:00:00:00:00:00',
  internal: false,
  cidr: 'fe80::1/64',
  scopeid: 2
};

describe('lanAddress', () => {
  it("prefers the Wi-Fi's IPv4 address, then a cable's, then any other", () => {
    expect(
      lanAddress({ lo: [ipv4('127.0.0.1', true)], eth0: [ipv4('192.168.1.20')], wlan0: [ipv6, ipv4('192.168.1.42')] })
    ).toBe('192.168.1.42');
    expect(lanAddress({ lo: [ipv4('127.0.0.1', true)], eth0: [ipv4('192.168.1.20')] })).toBe('192.168.1.20');
    expect(lanAddress({ tailscale0: [ipv4('100.64.0.7')] })).toBe('100.64.0.7');
  });

  it('is null with only the loopback or IPv6', () => {
    expect(lanAddress({ lo: [ipv4('127.0.0.1', true)], wlan0: [ipv6] })).toBeNull();
    expect(lanAddress({})).toBeNull();
  });
});
