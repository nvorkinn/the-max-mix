// Gets an image-based Pi's data partition ready on every boot, before it is mounted (kiosk-first-boot.service), and takes
// in what Raspberry Pi Imager's customisation wrote to the card. Root is read-only, so everything a Pi keeps of its own
// lives on /data, which image/persist.list binds over the paths that hold it (DATA_PATHS below are the ones written here).
//   node kiosk-first-boot.ts [--data <partition>] [--card <folder or FAT partition>]...
//
// 1. The partition grows to the end of the card: a flashed image ends where the image did. Once only, as it then reaches
//    the end.
// 2. It is formatted (ext4, label data) when it holds no filesystem, on a card just flashed (the flash image puts
//    FRESH_CARD on the card's first partition), and on the boot after kiosk-reset, which leaves RESET_FLAG on it. Imager
//    writes only the image, which ends before the data partition, so a card that was a kiosk before still holds its old
//    one: FRESH_CARD has it formatted all the same, so that every card starts as a new kiosk. A reset keeps the Pi's
//    name, its kiosk.env and its config.txt lines (RESET_KEEPS), and wipes the rest.
// 3. Imager's user-data and network-config (cloud-init's format, which the flash image's Imager list asks for) become
//    the Pi's own: the host name, the admin account's SSH keys, and the Wi-Fi as a NetworkManager profile. Imager writes
//    them to the card's first partition (rpi-imager's downloadthread.cpp), the autoboot one, which nothing else mounts,
//    so --card defaults to it. The card's copies are then deleted, as they hold the Wi-Fi password, so the next boot
//    finds nothing to take in.
// 4. The Pi's identity: a machine ID the first time, and the host name from /data, which the kernel gets here because
//    systemd set it from the image's /etc/hostname before /data was there. A Pi flashed without Imager's settings names
//    itself the-max-mix-<the last 4 hex digits of its serial number>, so every Pi has its own name with nothing set up.
import { randomBytes, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { chown, mkdir, mkdtemp, readFile, realpath, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { runCommand } from './nmcli.ts';
import type { Run } from './nmcli.ts';

/** What the Pi keeps on /data, relative to it. persist.list binds each one over the path in its comment. */
export const DATA_PATHS = {
  /** /etc/hostname */
  hostname: 'identity/hostname',
  /** /etc/machine-id */
  machineId: 'identity/machine-id',
  /** /etc/NetworkManager/system-connections */
  connections: 'network/system-connections',
  /** /home/admin */
  adminHome: 'home/admin',
  /** /data/the-max-mix/kiosk.env, the Pi's own settings (KIOSK_NAME, KIOSK_VIDEO_MODE and so on) */
  kioskEnv: 'the-max-mix/kiosk.env',
  /** /data/the-max-mix/config.txt, the Pi's own lines for the boot firmware's config.txt (image-update.ts OWN_CONFIG) */
  ownConfig: 'the-max-mix/config.txt'
} as const;

/** kiosk-reset leaves this on /data; the next boot formats it again. */
export const RESET_FLAG = '.kiosk-reset';
/**
 * The flash image (image/build.sh card) puts this on the card's first partition, which Imager writes afresh with each
 * flash; the first boot takes it off before it formats the data partition, so the next boot formats nothing.
 */
export const FRESH_CARD = 'the-max-mix-fresh-card';
/**
 * What a reset keeps: the Pi's name and its settings, which belong to the Pi and its screen, not to its owner. Its
 * config.txt lines are among them: without a screen's dtoverlay the Pi shows nothing after its next update.
 */
const RESET_KEEPS = [DATA_PATHS.hostname, DATA_PATHS.kioskEnv, DATA_PATHS.ownConfig] as const;

/** The admin account (sysusers.d in the image), whose SSH keys Imager's are. */
const ADMIN = { uid: 1000, gid: 1000 } as const;
/** The files Imager's customisation writes to the card (cloud-init's NoCloud data). */
const IMAGER_FILES = ['user-data', 'network-config', 'meta-data'] as const;
/** The GPT keeps a copy of itself in the last 33 sectors; a partition that ends within this many sectors (1 MiB) of
 * the end of the card has nothing left to grow into. */
const GROW_SLACK_SECTORS = 2048;
const FORMAT_TIMEOUT_MS = 180_000;
/** The Pi's serial number, from the firmware's device tree (16 hex digits, ending in a NUL). */
const SERIAL_NUMBER = '/proc/device-tree/serial-number';
/** What a Pi is called when nobody named it: this, a hyphen and the end of its serial number. */
const HOSTNAME_PREFIX = 'the-max-mix';

/** What Imager's user-data asks for. Anything left empty in Imager is missing. */
interface UserData {
  hostname?: string;
  /** The account named in Imager; the image's account is always admin, which gets these keys. */
  user?: string;
  sshKeys: string[];
}

interface WifiNetwork {
  ssid: string;
  /** The passphrase, or the 64 hexadecimal digits of the key; missing for an open network. */
  password?: string;
  isHidden: boolean;
}

/** A host name the Pi can have: one label of letters, digits and hyphens, not starting or ending with a hyphen. */
function isHostname(name: string): boolean {
  return name.length <= 63 && /^[a-z0-9-]+$/i.test(name) && !name.startsWith('-') && !name.endsWith('-');
}

function isMachineId(id: string): boolean {
  return /^[0-9a-f]{32}$/.test(id);
}

/** The file's details, or null when it is not there. */
async function statOrNull(file: string): Promise<Stats | null> {
  try {
    return await stat(file);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * The host name, account and SSH keys in Imager's user-data. Imager 2 writes `user:` (one account); older versions wrote
 * a `users:` list. Passwords are ignored: the admin account has none and SSH takes keys only.
 */
export function parseUserData(document: string): UserData {
  const data: unknown = parse(document);
  if (!isRecord(data)) return { sshKeys: [] };
  const users: unknown[] = Array.isArray(data['users']) ? data['users'] : [];
  // A `users:` list may start with the word default, the image's own account.
  const user = [data['user'], ...users].find(entry => isRecord(entry));
  const listed = isRecord(user) ? user['ssh_authorized_keys'] : undefined;
  const keys: unknown[] = Array.isArray(listed) ? listed : [];
  const hostname = text(data['hostname']);
  const name = isRecord(user) ? text(user['name']) : undefined;
  return {
    ...(hostname !== undefined && isHostname(hostname) && { hostname: hostname.toLowerCase() }),
    ...(name !== undefined && { user: name }),
    sshKeys: keys.map(key => text(key)).filter((key): key is string => key !== undefined && !/[\r\n]/.test(key))
  };
}

/** The Wi-Fi networks in Imager's network-config (netplan version 2), with or without its top-level `network:`. */
export function parseNetworkConfig(document: string): WifiNetwork[] {
  const data: unknown = parse(document);
  const network = isRecord(data) && isRecord(data['network']) ? data['network'] : data;
  const wifis = isRecord(network) && isRecord(network['wifis']) ? network['wifis'] : {};
  // Older Imager versions put `renderer: networkd` among the interfaces, so only the ones with access points count.
  return Object.values(wifis).flatMap(wifi => {
    const points = isRecord(wifi) && isRecord(wifi['access-points']) ? wifi['access-points'] : {};
    return Object.entries(points).flatMap(([ssid, point]): WifiNetwork[] => {
      if (ssid === '' || !isRecord(point)) return [];
      const auth = isRecord(point['auth']) ? point['auth'] : {};
      // As typed: spaces at either end are part of a passphrase.
      const password = [point['password'], auth['password']].find(value => typeof value === 'string' && value !== '');
      const isHidden = point['hidden'] === true;
      return typeof password !== 'string' || auth['key-management'] === 'none'
        ? [{ ssid, isHidden }]
        : [{ ssid, password, isHidden }];
    });
  });
}

/**
 * A value as GLib's key files (NetworkManager's .nmconnection files) read it: spaces at either end, which the reader
 * would drop, are written as \s.
 */
export function keyFileValue(value: string): string {
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');
  let start = 0;
  let end = escaped.length;
  while (start < end && escaped[start] === ' ') start += 1;
  while (end > start && escaped[end - 1] === ' ') end -= 1;
  return `${'\\s'.repeat(start)}${escaped.slice(start, end)}${'\\s'.repeat(escaped.length - end)}`;
}

/** The NetworkManager profile (keyfile) for a Wi-Fi network, which joins it whenever it is in range. */
export function nmConnection(wifi: WifiNetwork, uuid: string = randomUUID()): string {
  const ssid = keyFileValue(wifi.ssid);
  const lines = [
    '[connection]',
    `id=${ssid}`,
    `uuid=${uuid}`,
    'type=wifi',
    '',
    '[wifi]',
    'mode=infrastructure',
    `ssid=${ssid}`
  ];
  if (wifi.isHidden) lines.push('hidden=true');
  if (wifi.password) lines.push('', '[wifi-security]', 'key-mgmt=wpa-psk', `psk=${keyFileValue(wifi.password)}`);
  lines.push('', '[ipv4]', 'method=auto', '', '[ipv6]', 'addr-gen-mode=default', 'method=auto', '');
  return lines.join('\n');
}

/** The profile's file name: the network's name, with what a file name cannot hold replaced. */
export function connectionFileName(ssid: string): string {
  const name = ssid.replaceAll(/[/\\\0]/g, '_').replace(/^\.+/, '_');
  return `${name || 'wifi'}.nmconnection`;
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** Writes beside the file and moves it over, so a power cut leaves the old file or the new one. */
async function writeAtomic(file: string, content: string, mode: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o755 });
  await writeFile(`${file}.tmp`, content, { mode });
  await rename(`${file}.tmp`, file);
}

/** What importImager took in, for the journal. */
interface Imported {
  hostname?: string;
  sshKeys: number;
  wifi: string[];
}

/**
 * Takes in Imager's files from the card folder `card` onto the data partition mounted at `data`, then deletes them from
 * the card. Undefined when the card has none. `owner` is the admin account's, for its SSH keys (tests pass their own).
 */
export async function importImager(
  card: string,
  data: string,
  { owner = ADMIN }: { owner?: { uid: number; gid: number } } = {}
): Promise<Imported | undefined> {
  const userData = await readOptional(path.join(card, 'user-data'));
  const networkConfig = await readOptional(path.join(card, 'network-config'));
  if (userData === undefined && networkConfig === undefined) return undefined;
  const user: UserData = userData === undefined ? { sshKeys: [] } : parseUserData(userData);
  const wifi = networkConfig === undefined ? [] : parseNetworkConfig(networkConfig);

  if (user.hostname) await writeAtomic(path.join(data, DATA_PATHS.hostname), `${user.hostname}\n`, 0o644);
  if (user.sshKeys.length > 0) {
    const home = path.join(data, DATA_PATHS.adminHome);
    const ssh = path.join(home, '.ssh');
    const keys = path.join(ssh, 'authorized_keys');
    await mkdir(ssh, { recursive: true, mode: 0o700 });
    await writeAtomic(keys, `${user.sshKeys.join('\n')}\n`, 0o600);
    await Promise.all([home, ssh, keys].map(owned => chown(owned, owner.uid, owner.gid)));
  }
  const connections = path.join(data, DATA_PATHS.connections);
  // NetworkManager reads a profile only when it is root's and nobody else can read it (it holds the password).
  await Promise.all(
    wifi.map(network =>
      writeAtomic(path.join(connections, connectionFileName(network.ssid)), nmConnection(network), 0o600)
    )
  );

  // The card's copies go once everything is on /data: they hold the Wi-Fi password, and would be taken in again.
  await Promise.all(IMAGER_FILES.map(name => rm(path.join(card, name), { force: true })));
  return {
    ...(user.hostname !== undefined && { hostname: user.hostname }),
    sshKeys: user.sshKeys.length,
    wifi: wifi.map(network => network.ssid)
  };
}

/**
 * The name a Pi with no name of its own gets: the-max-mix-<the last 4 hex digits of its serial number>, or plain
 * the-max-mix when the serial number cannot be read.
 */
export function defaultHostname(serial = ''): string {
  const digits = serial.replaceAll('\0', '').trim().toLowerCase();
  return /^[0-9a-f]{4,}$/.test(digits) ? `${HOSTNAME_PREFIX}-${digits.slice(-4)}` : HOSTNAME_PREFIX;
}

/**
 * The machine ID and the host name, kept on /data: a machine ID is made the first time (`current`, the one systemd made up
 * for this boot while /data was not there, so the first boot's journal keeps its ID), and so is a host name when /data has
 * none (Imager's, taken in before this, comes first), from `serial`. Returns the host name, for the kernel.
 */
export async function ensureIdentity(data: string, current?: string, serial?: string): Promise<string> {
  const machineId = path.join(data, DATA_PATHS.machineId);
  if (!isMachineId((await readOptional(machineId))?.trim() ?? '')) {
    const now = current?.trim() ?? '';
    await writeAtomic(machineId, `${isMachineId(now) ? now : randomBytes(16).toString('hex')}\n`, 0o444);
  }
  const hostnameFile = path.join(data, DATA_PATHS.hostname);
  const hostname = (await readOptional(hostnameFile))?.trim() ?? '';
  if (isHostname(hostname)) return hostname;
  const made = defaultHostname(serial);
  await writeAtomic(hostnameFile, `${made}\n`, 0o644);
  return made;
}

/** Where a partition sits on its card, in 512-byte sectors (from /sys/class/block). */
interface PartitionPlace {
  /** The card, such as /dev/mmcblk0. */
  disk: string;
  number: number;
  start: number;
  size: number;
  diskSize: number;
}

/** True when the partition does not yet reach the end of the card. */
export function canGrow(place: PartitionPlace): boolean {
  return place.diskSize - (place.start + place.size) > GROW_SLACK_SECTORS;
}

/** Where the partition `device` (such as /dev/mmcblk0p6, or a link to it) sits, from `sys` (/sys/class/block). */
export async function partitionPlace(device: string, sys = '/sys/class/block'): Promise<PartitionPlace> {
  const name = path.basename(await realpath(device));
  // /sys/class/block/<partition> links into its card's folder.
  const partitionFolder = await realpath(path.join(sys, name));
  const disk = path.basename(path.dirname(partitionFolder));
  const read = async (...parts: string[]) => {
    const content = await readFile(path.join(sys, ...parts), 'utf8');
    return Number(content.trim());
  };
  return {
    disk: `/dev/${disk}`,
    number: await read(name, 'partition'),
    start: await read(name, 'start'),
    size: await read(name, 'size'),
    diskSize: await read(disk, 'size')
  };
}

async function must(run: Run, argv: string[], stdin?: string, timeoutMs?: number): Promise<string> {
  const result = await run(argv, stdin, timeoutMs);
  if (result.code !== 0) throw new Error(`${argv.join(' ')} failed (${result.code}): ${result.stderr.trim()}`);
  return result.stdout;
}

/** The partition's filesystem type, or '' when it holds none (blkid answers 2). */
async function filesystemOf(run: Run, partition: string): Promise<string> {
  const result = await run(['blkid', '--probe', '--output', 'value', '--match-tag', 'TYPE', partition]);
  return result.code === 0 ? result.stdout.trim() : '';
}

/** Grows the partition to the end of its card: the GPT's backup copy moves to the card's end first. */
async function grow(run: Run, place: PartitionPlace): Promise<void> {
  await must(run, ['sfdisk', '--relocate', 'gpt-bak-std', place.disk]);
  // ", +": the same start, as big as it can be. --no-reread: the card's other partitions are in use.
  await must(run, ['sfdisk', '--no-reread', '--no-tell-kernel', '-N', String(place.number), place.disk], ', +\n');
  await must(run, ['partx', '--update', '--nr', String(place.number), place.disk]);
}

async function format(run: Run, partition: string): Promise<void> {
  await must(run, ['mkfs.ext4', '-F', '-q', '-L', 'data', partition], undefined, FORMAT_TIMEOUT_MS);
}

/** The files a reset keeps, read from the data partition mounted at `data`. */
async function keptFiles(data: string): Promise<[file: string, content: string][]> {
  const contents = await Promise.all(RESET_KEEPS.map(file => readOptional(path.join(data, file))));
  return RESET_KEEPS.flatMap((file, index): [string, string][] => {
    const content = contents[index];
    return content === undefined ? [] : [[file, content]];
  });
}

/**
 * Whether any of the card folders has FRESH_CARD on it, taking it off: the card was just flashed. It counts only once it
 * is off, so a card it can't be taken off is never formatted at every boot.
 */
export async function wasJustFlashed(folders: readonly string[]): Promise<boolean> {
  let isFresh = false;
  for (const folder of folders) {
    const mark = path.join(folder, FRESH_CARD);
    // eslint-disable-next-line no-await-in-loop -- one card at a time
    if (!(await statOrNull(mark))) continue;
    try {
      // eslint-disable-next-line no-await-in-loop -- one card at a time
      await rm(mark);
      isFresh = true;
    } catch (error) {
      console.error(`Could not take ${FRESH_CARD} off ${folder}, so the data partition is kept: ${String(error)}`);
    }
  }
  return isFresh;
}

/** What prepareData did, for the journal. */
interface Prepared {
  isGrown: boolean;
  isFormatted: boolean;
  isReset: boolean;
}

/**
 * Grows and formats the data partition as needed, and mounts it at `mountpoint` for the import; the caller unmounts it,
 * and systemd then mounts it at /data as usual. `isFreshCard`: the card was just flashed, so whatever the partition
 * holds is a kiosk's from before, and it is formatted.
 */
export async function prepareData(
  partition: string,
  mountpoint: string,
  { run = runCommand, sys, isFreshCard = false }: { run?: Run; sys?: string; isFreshCard?: boolean } = {}
): Promise<Prepared> {
  const place = await partitionPlace(partition, sys);
  const isGrown = canGrow(place);
  if (isGrown) await grow(run, place);
  const mount = () => must(run, ['mount', '-t', 'ext4', partition, mountpoint]);
  const unmount = () => must(run, ['umount', mountpoint]);

  let isFormatted = false;
  let isReset = false;
  if (isFreshCard || (await filesystemOf(run, partition)) === '') {
    await format(run, partition);
    isFormatted = true;
    await mount();
  } else {
    await mount();
    if (await statOrNull(path.join(mountpoint, RESET_FLAG))) {
      const kept = await keptFiles(mountpoint);
      await unmount();
      await format(run, partition);
      await mount();
      await Promise.all(kept.map(([file, content]) => writeAtomic(path.join(mountpoint, file), content, 0o644)));
      isFormatted = true;
      isReset = true;
    } else if (isGrown) {
      // ext4 grows while mounted.
      await must(run, ['resize2fs', partition], undefined, FORMAT_TIMEOUT_MS);
    }
  }
  return { isGrown, isFormatted, isReset };
}

/** A card folder, or a FAT partition (mounted here for the import, `mounted` collects it to unmount). */
async function cardFolder(card: string, run: Run, mounted: string[]): Promise<string | undefined> {
  const info = await statOrNull(card);
  if (!info) return undefined;
  if (info.isDirectory()) return card;
  const folder = await mkdtemp('/run/kiosk-first-boot-card-');
  await must(run, ['mount', '-t', 'vfat', card, folder]);
  mounted.push(folder);
  return folder;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      data: { type: 'string', default: '/dev/disk/by-partlabel/data' },
      card: { type: 'string', multiple: true, default: ['/dev/disk/by-partlabel/autoboot'] }
    }
  });
  const run = runCommand;
  const mountpoint = await mkdtemp('/run/kiosk-first-boot-data-');
  const mounted = [mountpoint];
  try {
    const cards: [card: string, folder: string][] = [];
    for (const card of values.card) {
      // One card at a time, in the order given: each may mount a partition.
      // eslint-disable-next-line no-await-in-loop
      const folder = await cardFolder(card, run, mounted);
      if (folder) cards.push([card, folder]);
    }
    const isFreshCard = await wasJustFlashed(cards.map(([, folder]) => folder));
    const prepared = await prepareData(values.data, mountpoint, { run, isFreshCard });
    if (prepared.isGrown) console.log('Grew the data partition to the end of the card');
    if (prepared.isReset) {
      console.log('Reset: formatted the data partition, keeping the name, kiosk.env and config.txt');
    } else if (prepared.isFormatted) {
      console.log(isFreshCard ? 'Formatted the data partition of a card just flashed' : 'Formatted the data partition');
    }

    for (const [card, folder] of cards) {
      // eslint-disable-next-line no-await-in-loop
      const imported = await importImager(folder, mountpoint);
      if (!imported) continue;
      // Never the Wi-Fi password: only what was taken in.
      const wifi = imported.wifi.length > 0 ? imported.wifi.join(', ') : 'none';
      console.log(
        `Took in Raspberry Pi Imager's settings from ${card}: host name ${imported.hostname ?? 'none'}, ` +
          `${imported.sshKeys} SSH key(s), Wi-Fi ${wifi}`
      );
    }

    const hostname = await ensureIdentity(
      mountpoint,
      await readOptional('/etc/machine-id'),
      await readOptional(SERIAL_NUMBER)
    );
    await writeFile('/proc/sys/kernel/hostname', hostname);
    console.log(`Host name ${hostname}`);
  } finally {
    // rmdir, never rm -r: a folder that did not unmount still holds the partition's files.
    await Promise.all(
      mounted.map(async folder => {
        await run(['umount', folder]);
        try {
          await rmdir(folder);
        } catch {
          // Still mounted: left for the reboot to clear.
        }
      })
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
