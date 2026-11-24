// @vitest-environment node
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  connectionFileName,
  DATA_PATHS,
  defaultHostname,
  ensureIdentity,
  importImager,
  keyFileValue,
  canGrow,
  nmConnection,
  parseNetworkConfig,
  parseUserData,
  partitionPlace,
  prepareData,
  RESET_FLAG
} from './kiosk-first-boot.ts';
import type { Result } from './nmcli.ts';

const FIXTURES = fileURLToPath(new URL('imager-fixtures', import.meta.url));
const fixture = (name: string, file: string) => readFile(path.join(FIXTURES, name, file), 'utf8');
const ME = { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 };

/** An empty folder for one test, removed after it. */
async function folder(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'kiosk-first-boot-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}

describe('parseUserData', () => {
  it("reads Imager 2's host name, account and SSH keys", async () => {
    expect(parseUserData(await fixture('imager-2', 'user-data'))).toEqual({
      hostname: 'the-max-mix-4',
      user: 'admin',
      sshKeys: [
        'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureKeyForTestsOnlyNotARealKey0000000001 nikolai@laptop',
        'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureKeyForTestsOnlyNotARealKey0000000002 nikolai@phone'
      ]
    });
  });

  it("reads Imager 1's users list", async () => {
    expect(parseUserData(await fixture('imager-1', 'user-data'))).toEqual({
      hostname: 'the-max-mix',
      user: 'admin',
      sshKeys: ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureKeyForTestsOnlyNotARealKey0000000003 nikolai@old-laptop']
    });
  });

  it('lowers the host name, and takes an account with no keys', async () => {
    expect(parseUserData(await fixture('imager-2-open', 'user-data'))).toEqual({
      hostname: 'kitchen-kiosk',
      user: 'pi',
      sshKeys: []
    });
  });

  it('skips a host name the Pi could not have, and anything that is not user-data', () => {
    expect(parseUserData('hostname: "bad name; rm -rf /"\n')).toEqual({ sshKeys: [] });
    expect(parseUserData('hostname: -dash\n')).toEqual({ sshKeys: [] });
    expect(parseUserData('users:\n- default\n- name: admin\n  ssh_authorized_keys: ["a", 1, ""]\n')).toEqual({
      user: 'admin',
      sshKeys: ['a']
    });
    expect(parseUserData('')).toEqual({ sshKeys: [] });
    expect(parseUserData('- a list\n')).toEqual({ sshKeys: [] });
  });
});

describe('parseNetworkConfig', () => {
  it("reads Imager 2's network, its passphrase exactly as typed", async () => {
    expect(parseNetworkConfig(await fixture('imager-2', 'network-config'))).toEqual([
      { ssid: 'Home Wi-Fi', password: ' correct horse "battery" ', isHidden: false }
    ]);
  });

  it('reads a hidden open network', async () => {
    expect(parseNetworkConfig(await fixture('imager-2-open', 'network-config'))).toEqual([
      { ssid: 'Café/Guest', isHidden: true }
    ]);
  });

  it("reads Imager 1's, past the renderer among the interfaces", async () => {
    const key = '8c0ffee5d1b2a3c4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c';
    expect(parseNetworkConfig(await fixture('imager-1', 'network-config'))).toEqual([
      { ssid: 'Home Wi-Fi', password: key, isHidden: false }
    ]);
  });

  it('reads netplan without its top-level network, and a password under auth', () => {
    const config = 'wifis:\n  wlan0:\n    access-points:\n      Lab:\n        auth:\n          password: secret12\n';
    expect(parseNetworkConfig(config)).toEqual([{ ssid: 'Lab', password: 'secret12', isHidden: false }]);
    expect(parseNetworkConfig('network:\n  version: 2\n  ethernets:\n    eth0:\n      dhcp4: true\n')).toEqual([]);
    expect(parseNetworkConfig('')).toEqual([]);
  });
});

describe('nmConnection', () => {
  it('writes a profile NetworkManager joins the network with', () => {
    const uuid = '2b0c6f4e-7a1d-4c5e-9b8f-0d1e2f3a4b5c';
    expect(nmConnection({ ssid: 'Home Wi-Fi', password: 'secret12', isHidden: false }, uuid)).toBe(
      [
        '[connection]',
        'id=Home Wi-Fi',
        `uuid=${uuid}`,
        'type=wifi',
        '',
        '[wifi]',
        'mode=infrastructure',
        'ssid=Home Wi-Fi',
        '',
        '[wifi-security]',
        'key-mgmt=wpa-psk',
        'psk=secret12',
        '',
        '[ipv4]',
        'method=auto',
        '',
        '[ipv6]',
        'addr-gen-mode=default',
        'method=auto',
        ''
      ].join('\n')
    );
  });

  it('leaves the security out for an open network, and marks a hidden one', () => {
    const profile = nmConnection({ ssid: 'Café/Guest', isHidden: true });
    expect(profile).toContain('ssid=Café/Guest\nhidden=true\n');
    expect(profile).not.toContain('wifi-security');
  });

  it("escapes what GLib's key files would read otherwise", () => {
    expect(keyFileValue(' correct horse "battery" ')).toBe(String.raw`\scorrect horse "battery"\s`);
    expect(keyFileValue('a\\b\nc\td')).toBe(String.raw`a\\b\nc\td`);
    expect(keyFileValue('  ')).toBe(String.raw`\s\s`);
  });

  it('names the file after the network, safely', () => {
    expect(connectionFileName('Café/Guest')).toBe('Café_Guest.nmconnection');
    expect(connectionFileName('..')).toBe('_.nmconnection');
    expect(connectionFileName('')).toBe('wifi.nmconnection');
  });
});

/** A copy of an Imager fixture as a card's first partition, with a file of the card's own beside it. */
async function card(name: string): Promise<string> {
  const copy = path.join(await folder(), 'card');
  await cp(path.join(FIXTURES, name), copy, { recursive: true });
  await writeFile(path.join(copy, 'config.txt'), 'arm_64bit=1\n');
  return copy;
}

/** A command runner whose every command fails. */
const failing = (): Promise<Result> => Promise.resolve({ code: 1, stdout: '', stderr: 'sfdisk: device busy\n' });

describe('importImager', () => {
  it("puts Imager's settings on /data and deletes them from the card", async () => {
    const boot = await card('imager-2');
    const data = await folder();

    expect(await importImager(boot, data, { owner: ME })).toEqual({
      hostname: 'the-max-mix-4',
      sshKeys: 2,
      wifi: ['Home Wi-Fi']
    });
    expect(await readFile(path.join(data, DATA_PATHS.hostname), 'utf8')).toBe('the-max-mix-4\n');
    const keys = path.join(data, DATA_PATHS.adminHome, '.ssh', 'authorized_keys');
    expect((await readFile(keys, 'utf8')).split('\n')).toHaveLength(3);
    expect((await stat(keys)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(keys))).mode & 0o777).toBe(0o700);
    const profile = path.join(data, DATA_PATHS.connections, 'Home Wi-Fi.nmconnection');
    expect(await readFile(profile, 'utf8')).toContain(String.raw`psk=\scorrect horse "battery"\s`);
    expect((await stat(profile)).mode & 0o777).toBe(0o600);
    // Only the card's other files are left.
    expect(await readdir(boot)).toEqual(['config.txt']);
  });

  it('takes in a card with Wi-Fi only, and leaves the keys alone', async () => {
    const boot = await card('imager-2-open');
    const data = await folder();

    expect(await importImager(boot, data, { owner: ME })).toEqual({
      hostname: 'kitchen-kiosk',
      sshKeys: 0,
      wifi: ['Café/Guest']
    });
    expect(await readdir(path.join(data, DATA_PATHS.connections))).toEqual(['Café_Guest.nmconnection']);
    await expect(stat(path.join(data, DATA_PATHS.adminHome))).rejects.toThrow();
  });

  it('does nothing without Imager files', async () => {
    const boot = await folder();
    await writeFile(path.join(boot, 'config.txt'), '');
    expect(await importImager(boot, await folder(), { owner: ME })).toBeUndefined();
    expect(await readdir(boot)).toEqual(['config.txt']);
  });
});

describe('defaultHostname', () => {
  it('ends in the last 4 hex digits of the serial number', () => {
    expect(defaultHostname('100000003a9b7c2d\0')).toBe('the-max-mix-7c2d');
  });

  it('is plain the-max-mix without a serial number', () => {
    expect(defaultHostname(undefined)).toBe('the-max-mix');
    expect(defaultHostname('')).toBe('the-max-mix');
  });
});

describe('ensureIdentity', () => {
  it('keeps the machine ID systemd made up for the first boot, and returns the name on /data', async () => {
    const data = await folder();
    const id = '0123456789abcdef0123456789abcdef';
    await writeFile(path.join(data, DATA_PATHS.hostname), 'kitchen\n');
    expect(await ensureIdentity(data, `${id}\n`, '10000000abcd1234\0')).toBe('kitchen');
    expect(await readFile(path.join(data, DATA_PATHS.machineId), 'utf8')).toBe(`${id}\n`);

    expect(await ensureIdentity(data, 'ffffffffffffffffffffffffffffffff')).toBe('kitchen');
    // Made once only.
    expect(await readFile(path.join(data, DATA_PATHS.machineId), 'utf8')).toBe(`${id}\n`);
  });

  it('names a Pi nobody named after its serial number, once', async () => {
    const data = await folder();
    expect(await ensureIdentity(data, '', '10000000abcd1E2f\0')).toBe('the-max-mix-1e2f');
    expect(await readFile(path.join(data, DATA_PATHS.hostname), 'utf8')).toBe('the-max-mix-1e2f\n');
    expect(await ensureIdentity(data, '', '10000000ffffffff\0')).toBe('the-max-mix-1e2f');
  });

  it('makes a machine ID up when systemd has none', async () => {
    const data = await folder();
    await ensureIdentity(data, '');
    expect(await readFile(path.join(data, DATA_PATHS.machineId), 'utf8')).toMatch(/^[0-9a-f]{32}\n$/);
  });
});

/** A card in /sys/class/block (the card's size and the data partition's place, in sectors) and its /dev entry. */
async function blockDevices(place: { start: number; size: number; diskSize: number }) {
  const root = await folder();
  const sys = path.join(root, 'sys');
  const disk = path.join(root, 'devices', 'mmcblk0');
  await mkdir(path.join(disk, 'mmcblk0p6'), { recursive: true });
  await writeFile(path.join(disk, 'size'), `${place.diskSize}\n`);
  await writeFile(path.join(disk, 'mmcblk0p6', 'partition'), '6\n');
  await writeFile(path.join(disk, 'mmcblk0p6', 'start'), `${place.start}\n`);
  await writeFile(path.join(disk, 'mmcblk0p6', 'size'), `${place.size}\n`);
  await mkdir(sys);
  await symlink(disk, path.join(sys, 'mmcblk0'));
  await symlink(path.join(disk, 'mmcblk0p6'), path.join(sys, 'mmcblk0p6'));
  await mkdir(path.join(root, 'dev'));
  const partition = path.join(root, 'dev', 'mmcblk0p6');
  await writeFile(partition, '');
  // As /dev/disk/by-partlabel/data links to the partition.
  const label = path.join(root, 'dev', 'data');
  await symlink(partition, label);
  return { sys, partition: label, mountpoint: path.join(root, 'mnt') };
}

/** A fake of the commands prepareData runs: blkid finds `filesystem`, mkfs empties the mount point. */
function fakeCommands(mountpoint: string, filesystem: string) {
  const calls: string[] = [];
  const run = async (argv: string[], stdin?: string): Promise<Result> => {
    const [command = ''] = argv;
    calls.push([...argv, ...(stdin === undefined ? [] : [`<${stdin.trim()}`])].join(' ').replaceAll(mountpoint, 'MNT'));
    if (command === 'blkid') {
      return filesystem ? { code: 0, stdout: `${filesystem}\n`, stderr: '' } : { code: 2, stdout: '', stderr: '' };
    }
    if (command === 'mkfs.ext4') {
      await rm(mountpoint, { recursive: true, force: true });
      await mkdir(mountpoint);
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

describe('prepareData', () => {
  const SECTORS_16_GB = 31_116_288;
  const FLASHED = { start: 7_340_032, size: 2048, diskSize: SECTORS_16_GB };

  it('reads where the partition sits', async () => {
    const devices = await blockDevices(FLASHED);
    expect(await partitionPlace(devices.partition, devices.sys)).toEqual({
      disk: '/dev/mmcblk0',
      number: 6,
      ...FLASHED
    });
    expect(canGrow({ disk: '', number: 6, ...FLASHED })).toBe(true);
    expect(canGrow({ disk: '', number: 6, ...FLASHED, size: SECTORS_16_GB - FLASHED.start - 33 })).toBe(false);
  });

  it('grows and formats a freshly flashed card', async () => {
    const devices = await blockDevices(FLASHED);
    await mkdir(devices.mountpoint);
    const { run, calls } = fakeCommands(devices.mountpoint, '');

    expect(await prepareData(devices.partition, devices.mountpoint, { run, sys: devices.sys })).toEqual({
      isGrown: true,
      isFormatted: true,
      isReset: false
    });
    expect(calls).toEqual([
      'sfdisk --relocate gpt-bak-std /dev/mmcblk0',
      'sfdisk --no-reread --no-tell-kernel -N 6 /dev/mmcblk0 <, +',
      'partx --update --nr 6 /dev/mmcblk0',
      `blkid --probe --output value --match-tag TYPE ${devices.partition}`,
      `mkfs.ext4 -F -q -L data ${devices.partition}`,
      `mount -t ext4 ${devices.partition} MNT`
    ]);
  });

  it('only mounts a partition that is ready', async () => {
    const devices = await blockDevices({ ...FLASHED, size: SECTORS_16_GB - FLASHED.start - 33 });
    await mkdir(devices.mountpoint);
    const { run, calls } = fakeCommands(devices.mountpoint, 'ext4');

    expect(await prepareData(devices.partition, devices.mountpoint, { run, sys: devices.sys })).toEqual({
      isGrown: false,
      isFormatted: false,
      isReset: false
    });
    expect(calls).toEqual([
      `blkid --probe --output value --match-tag TYPE ${devices.partition}`,
      `mount -t ext4 ${devices.partition} MNT`
    ]);
  });

  it('formats it again after a reset, keeping the name and kiosk.env', async () => {
    const devices = await blockDevices({ ...FLASHED, size: SECTORS_16_GB - FLASHED.start - 33 });
    const data = devices.mountpoint;
    const files = {
      [RESET_FLAG]: '',
      [DATA_PATHS.hostname]: 'kitchen\n',
      [DATA_PATHS.kioskEnv]: 'KIOSK_VIDEO_MODE=1280x800@60\n',
      [DATA_PATHS.machineId]: '0123456789abcdef0123456789abcdef\n',
      'network/system-connections/Home.nmconnection': '[connection]\n'
    };
    await Promise.all(
      Object.entries(files).map(async ([file, content]) => {
        await mkdir(path.dirname(path.join(data, file)), { recursive: true });
        await writeFile(path.join(data, file), content);
      })
    );
    const { run, calls } = fakeCommands(data, 'ext4');

    expect(await prepareData(devices.partition, data, { run, sys: devices.sys })).toEqual({
      isGrown: false,
      isFormatted: true,
      isReset: true
    });
    expect(calls.slice(1)).toEqual([
      `mount -t ext4 ${devices.partition} MNT`,
      'umount MNT',
      `mkfs.ext4 -F -q -L data ${devices.partition}`,
      `mount -t ext4 ${devices.partition} MNT`
    ]);
    expect((await readdir(data)).toSorted((a, b) => a.localeCompare(b))).toEqual(['identity', 'the-max-mix']);
    expect(await readdir(path.join(data, 'identity'))).toEqual(['hostname']);
    expect(await readFile(path.join(data, DATA_PATHS.kioskEnv), 'utf8')).toBe('KIOSK_VIDEO_MODE=1280x800@60\n');
  });

  it('grows the filesystem of a partition that grew', async () => {
    const devices = await blockDevices(FLASHED);
    await mkdir(devices.mountpoint);
    const { run, calls } = fakeCommands(devices.mountpoint, 'ext4');

    await prepareData(devices.partition, devices.mountpoint, { run, sys: devices.sys });
    expect(calls.at(-1)).toBe(`resize2fs ${devices.partition}`);
  });

  it('stops when a command fails', async () => {
    const devices = await blockDevices(FLASHED);
    const prepared = prepareData(devices.partition, devices.mountpoint, { run: failing, sys: devices.sys });
    await expect(prepared).rejects.toThrow(
      'sfdisk --relocate gpt-bak-std /dev/mmcblk0 failed (1): sfdisk: device busy'
    );
  });
});
