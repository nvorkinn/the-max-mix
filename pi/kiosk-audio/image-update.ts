// Updates on image Pis: the whole OS is one RAUC bundle on GitHub, installed into the slot the Pi does not run from and
// tried once on the next boot (boot-slots.ts). One code path does it for the timer, for Check for updates and Install
// on the screen (kiosk-audio), and for kiosk-rollback (kiosk-update.ts):
//
//   check    read the channel's bundle.txt (cheap, not the rate-limited API), which names its bundle, read the bundle's
//            version from its manifest only when that changed, and compare it with the booted version, the installed one
//            and the failed ones.
//   install  rauc install, streaming from the URL, with its progress as journal lines the app turns into its bar.
//   apply    reboot with tryboot into the installed slot (04:30, Restart, or at once on the dev and branch channels).
//   health   kiosk-health.ts decides after each boot; a tried slot that is not kept is a failed version, never retried.
//
// Versions are `<ref>+<commit>` (v2.53.0+1ada1d2…, dev+1ada1d2…): the bundle manifest's version, and the booted one
// from the build's release.env.
import type { Rauc } from './rauc.ts';

const REPO = 'nvorkinn/the-max-mix';
/**
 * On every release and pre-release, the file that names its bundle (its download URL). Each build's bundle has a name of
 * its own and is never replaced, because RAUC streams it with range requests: a Pi in the middle of an install keeps
 * reading the file it started on while the channel moves to a newer one (.github/workflows/image.yml).
 */
const POINTER = 'bundle.txt';
const DOWNLOADS = `https://github.com/${REPO}/releases/download/`;
/** Per-device settings (KIOSK_UPDATE_CHANNEL among them). */
export const KIOSK_ENV = '/data/the-max-mix/kiosk.env';
/** Written by the image build: KIOSK_RELEASE_REF and KIOSK_RELEASE_COMMIT of the running slot. */
export const RELEASE_ENV = '/usr/lib/the-max-mix/release.env';
/** The updater's own state, on /data so both slots share it. Root writes it; kiosk-audio only reads it. */
export const STATE_FILE = '/data/the-max-mix/update/state.json';
/** The timer runs every 2 minutes; a Pi on the stable channel checks only this often. */
export const STABLE_EVERY_MS = 6 * 60 * 60 * 1000;
/** How many failed versions are remembered. */
const MAX_FAILED = 10;
const SYSTEMCTL = '/usr/bin/systemctl';
/** Logged just before the reboot into a newly installed slot. */
export const RESTART_LINE = 'Restarting into the update.';

type Channel = 'stable' | 'dev' | `branch-${string}`;

/** KEY=value lines, as systemd's EnvironmentFile reads them: # comments, values optionally in quotes. */
export function parseEnv(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    const equals = line.indexOf('=');
    const key = line.slice(0, Math.max(equals, 0)).trim();
    if (line.startsWith('#') || !/^[A-Za-z_]\w*$/.test(key)) continue;
    const value = line.slice(equals + 1).trim();
    const isQuoted = value.length >= 2 && (value.startsWith('"') || value.startsWith("'")) && value.at(-1) === value[0];
    values[key] = isQuoted ? value.slice(1, -1) : value;
  }
  return values;
}

/** KIOSK_UPDATE_CHANNEL: stable, dev or branch-<name>; anything else (or nothing) is stable. */
export function parseChannel(value: string | undefined): Channel {
  if (value === 'dev') return 'dev';
  if (value && /^branch-[\w.-]+$/.test(value)) return value as Channel;
  return 'stable';
}

/** Where the channel's bundle.txt is: on the latest release, or the rolling pre-release named after the channel. */
export function pointerUrl(channel: Channel): string {
  return channel === 'stable'
    ? `https://github.com/${REPO}/releases/latest/download/${POINTER}`
    : `${DOWNLOADS}${channel}/${POINTER}`;
}

/** The bundle a bundle.txt names: a .raucb on one of this repository's releases, or null for anything else. */
export function parsePointer(text: string): string | null {
  const url = text.trim();
  return url.startsWith(DOWNLOADS) && /^\w[\w.-]*\/\w[\w.-]*\.raucb$/.test(url.slice(DOWNLOADS.length)) ? url : null;
}

export interface UpdateState {
  /** An installed slot waiting for its first boot (`tried` once the tryboot reboot has begun). */
  pending: { version: string; slot: string; tried: boolean } | null;
  /** Versions that did not pass their first boot, newest last: never installed again. */
  failed: string[];
  /** The bundle last inspected, so it is not read again. */
  seen: { url: string; version: string | null } | null;
  /** When the timer last checked (ms since the epoch). */
  checkedAt: number | null;
}

const EMPTY: UpdateState = { pending: null, failed: [], seen: null, checkedAt: null };

/** What the updater needs from the Pi; tests pass fakes. */
export interface UpdateIO {
  rauc: Rauc;
  /** A file's text, or null when there is none. */
  readText: (file: string) => Promise<string | null>;
  /** Saves the state (root only: kiosk-audio never calls it). */
  writeState: (state: UpdateState) => Promise<void>;
  /** The text of a small file at `url`; null for none (404). Rejects offline. */
  fetchText: (url: string) => Promise<string | null>;
  /** Runs a program; rejects when it fails. */
  run: (argv: string[]) => Promise<void>;
  /** Reboots once into the other slot: the firmware's tryboot. */
  tryboot: () => Promise<void>;
  /** Whether the firmware started this boot as a tryboot. */
  isTrialBoot: () => Promise<boolean>;
  now: () => number;
  log: (line: string) => void;
}

export async function readState(io: Pick<UpdateIO, 'readText'>): Promise<UpdateState> {
  try {
    const parsed = JSON.parse((await io.readText(STATE_FILE)) ?? '{}') as Partial<UpdateState>;
    return {
      pending: parsed.pending ?? null,
      failed: Array.isArray(parsed.failed) ? parsed.failed : [],
      seen: parsed.seen ?? null,
      checkedAt: parsed.checkedAt ?? null
    };
  } catch {
    return { ...EMPTY };
  }
}

function withFailed(state: UpdateState, version: string): UpdateState {
  return { ...state, failed: [...state.failed.filter(failed => failed !== version), version].slice(-MAX_FAILED) };
}

async function readChannel(io: Pick<UpdateIO, 'readText'>): Promise<Channel> {
  return parseChannel(parseEnv((await io.readText(KIOSK_ENV)) ?? '')['KIOSK_UPDATE_CHANNEL']);
}

/** The running slot's version, from the build's release.env; null when it does not say. */
async function bootedVersion(io: Pick<UpdateIO, 'readText'>): Promise<string | null> {
  const release = parseEnv((await io.readText(RELEASE_ENV)) ?? '');
  const ref = release['KIOSK_RELEASE_REF'];
  const commit = release['KIOSK_RELEASE_COMMIT'];
  return ref && commit ? `${ref}+${commit}` : null;
}

interface UpdateStatus {
  channel: Channel;
  /** The running version. */
  current: string | null;
  /** A version installed in the other slot and waiting for a restart. */
  installed: string | null;
  /** The newest version that failed its first boot, if any. */
  failed: string | null;
  /** RAUC is installing something now. */
  busy: boolean;
}

async function status(io: Pick<UpdateIO, 'readText' | 'rauc'>): Promise<UpdateStatus> {
  const state = await readState(io);
  return {
    channel: await readChannel(io),
    current: await bootedVersion(io),
    installed: state.pending && !state.pending.tried ? state.pending.version : null,
    failed: state.failed.at(-1) ?? null,
    busy: (await io.rauc.operation()) !== 'idle'
  };
}

/**
 * up-to-date, available (`latest` can be installed), installed (it waits for a restart), failed (it failed its first
 * boot here, so it is not installed again), none (nothing is published on the channel yet) or unreachable (offline).
 */
type CheckResult = 'up-to-date' | 'available' | 'installed' | 'failed' | 'none' | 'unreachable';

export interface Checked extends UpdateStatus {
  result: CheckResult;
  /** The version on the channel, when it could be read. */
  latest: string | null;
}

/** Looks at the channel's bundle. `shouldRemember` keeps its version for the next check (root only). */
export async function check(io: UpdateIO, shouldRemember = false): Promise<Checked> {
  return (await look(io, shouldRemember)).checked;
}

async function look(io: UpdateIO, shouldRemember: boolean): Promise<{ checked: Checked; url: string | null }> {
  const now = await status(io);
  let url: string | null;
  try {
    const pointer = await io.fetchText(pointerUrl(now.channel));
    url = pointer === null ? null : parsePointer(pointer);
  } catch {
    return { checked: { ...now, result: 'unreachable', latest: null }, url: null };
  }
  if (url === null) return { checked: { ...now, result: 'none', latest: null }, url };
  const state = await readState(io);
  let latest: string | null;
  if (state.seen?.url === url) {
    latest = state.seen.version;
  } else {
    latest = await io.rauc.inspect(url);
    if (shouldRemember) await io.writeState({ ...state, seen: { url, version: latest } });
  }
  let result: CheckResult = 'available';
  if (latest === null) result = 'none';
  else if (latest === now.current) result = 'up-to-date';
  else if (latest === now.installed) result = 'installed';
  else if (state.failed.includes(latest)) result = 'failed';
  return { checked: { ...now, result, latest }, url };
}

/** Installs the channel's bundle into the other slot when it is newer; the progress goes to the log as it comes. */
async function install(io: UpdateIO): Promise<Checked> {
  const { checked, url } = await look(io, true);
  if (url === null || checked.latest === null || checked.result !== 'available') return checked;
  io.log(`Installing ${checked.latest}.`);
  let shown = -1;
  await io.rauc.install(url, ({ percent, message }) => {
    if (percent === shown) return;
    shown = percent;
    io.log(`Update progress: ${percent}% ${message}`.trimEnd());
  });
  // The bundle at a URL is never replaced, so it holds the version its manifest said. Anything else here would not
  // match the next check's, which would then install it again.
  const booted = await io.rauc.bootSlot();
  const slot = (await io.rauc.slots()).find(found => found.bootname !== null && found.bootname !== booted);
  if (!slot?.bootname) throw new Error('RAUC installed the update into no other slot.');
  const version = checked.latest;
  await io.writeState({ ...(await readState(io)), pending: { version, slot: slot.bootname, tried: false } });
  io.log(`Installed ${version}. It starts with the next restart.`);
  return { ...checked, result: 'installed', installed: version };
}

/** Reboots once into the installed slot (tryboot) when one waits: 'restarting', or 'none' when none waits. */
export async function apply(io: UpdateIO): Promise<'restarting' | 'none'> {
  const state = await readState(io);
  if (!state.pending || state.pending.tried) return 'none';
  await io.writeState({ ...state, pending: { ...state.pending, tried: true } });
  io.log(RESTART_LINE);
  try {
    await io.tryboot();
  } catch (error) {
    // Still waiting for a restart, so the next check does not install it again.
    await io.writeState({ ...(await readState(io)), pending: { ...state.pending, tried: false } });
    throw error;
  }
  return 'restarting';
}

/** 04:30 and the Restart button: into the installed update when one waits, otherwise a restart of the kiosk. */
export async function restart(io: UpdateIO): Promise<void> {
  if ((await apply(io)) === 'none') await io.run([SYSTEMCTL, 'restart', 'kiosk.service']);
}

/**
 * The timer (`isScheduled`) and the screen's Install: check, install anything newer, and on the dev and branch channels
 * restart into it at once. A stable Pi's timer checks every 6 hours only.
 */
export async function run(io: UpdateIO, isScheduled: boolean): Promise<Checked | null> {
  const channel = await readChannel(io);
  if (isScheduled) {
    const state = await readState(io);
    if (channel === 'stable' && state.checkedAt !== null && io.now() - state.checkedAt < STABLE_EVERY_MS) return null;
    await io.writeState({ ...state, checkedAt: io.now() });
  }
  if ((await io.rauc.operation()) !== 'idle') {
    io.log('An update is already being installed.');
    return null;
  }
  const done = await install(io);
  if (done.result === 'up-to-date') {
    io.log(`Up to date (${done.current ?? 'unknown version'}).`);
  } else if (done.result === 'failed') {
    io.log(`${done.latest ?? ''} failed on this Pi before, so it is not installed again.`);
  } else if (channel !== 'stable' && done.result === 'installed') {
    await apply(io);
  }
  return done;
}

/**
 * At each boot, before the health check: settles what happened to a tried update. Returns 'trial' when this boot is
 * the first of a newly installed slot (the health check decides whether it stays), otherwise 'normal'. A tried slot the
 * Pi did not come back up on (a hang, a panic, a failed health check) is a failed version.
 */
export async function afterBoot(io: UpdateIO): Promise<'trial' | 'normal'> {
  const state = await readState(io);
  const pending = state.pending;
  // A trial boot counts even with no note, e.g. after an install by hand with `rauc install`.
  if (!pending?.tried) return (await io.isTrialBoot()) ? 'trial' : 'normal';
  const booted = await io.rauc.bootSlot();
  if (booted === pending.slot && (await io.isTrialBoot())) return 'trial';
  if (booted === pending.slot) {
    // It was kept already (marked good), and only the note was left behind.
    await io.writeState({ ...state, pending: null });
    return 'normal';
  }
  io.log(`${pending.version} did not start properly, so the Pi went back to ${booted}. It is not installed again.`);
  await io.rauc.mark('bad', 'other');
  await io.writeState({ ...withFailed(state, pending.version), pending: null });
  return 'normal';
}

/** The health check passed: keep the running slot (on a trial boot, this makes it the one every boot starts). */
export async function keep(io: UpdateIO, boot: 'trial' | 'normal'): Promise<void> {
  await io.rauc.mark('good', 'booted');
  if (boot !== 'trial') return;
  const state = await readState(io);
  io.log(`Kept ${state.pending?.version ?? 'the update'}.`);
  await io.writeState({ ...state, pending: null });
}

/** The health check failed: on a trial boot, mark the slot bad and reboot into the old one. */
export async function giveUp(io: UpdateIO, boot: 'trial' | 'normal', reason: string): Promise<void> {
  io.log(`Not healthy: ${reason}`);
  if (boot !== 'trial') return;
  const state = await readState(io);
  const version = state.pending?.version ?? (await bootedVersion(io)) ?? 'unknown';
  io.log(`Going back to the previous version; ${version} is not installed again.`);
  await io.rauc.mark('bad', 'booted');
  await io.writeState({ ...withFailed(state, version), pending: null });
  await io.run([SYSTEMCTL, 'reboot']);
}

/**
 * kiosk-rollback: tries the other slot (it still holds the previous version) at once, and keeps it once it is healthy.
 * The version left behind counts as failed, so the timer does not put it back.
 */
export async function rollback(io: UpdateIO): Promise<void> {
  const booted = await io.rauc.bootSlot();
  const other = (await io.rauc.slots()).find(slot => slot.bootname !== null && slot.bootname !== booted);
  if (!other?.bootname) throw new Error('There is no other slot to go back to.');
  const current = (await bootedVersion(io)) ?? 'unknown';
  await io.rauc.mark('active', 'other');
  const state = withFailed(await readState(io), current);
  await io.writeState({
    ...state,
    pending: { version: other.bundleVersion ?? 'the previous version', slot: other.bootname, tried: true }
  });
  io.log(`Going back from ${current} to ${other.bundleVersion ?? 'the previous version'}.`);
  await io.tryboot();
}

/** The boot slot RAUC just wrote, from its post-install handler's environment; null when it wrote none. */
export function installedBootDevice(env: Readonly<Record<string, string | undefined>>): string | null {
  const targets = (env['RAUC_TARGET_SLOTS'] ?? '').split(/\s+/);
  for (const number of targets) {
    if (number !== '' && env[`RAUC_SLOT_CLASS_${number}`] === 'boot') return env[`RAUC_SLOT_DEVICE_${number}`] ?? null;
  }
  return null;
}

/**
 * The partition label of the root slot RAUC just wrote (root-a or root-b), from its device (/etc/rauc/system.conf names
 * each by /dev/disk/by-partlabel); null when it wrote none.
 */
export function installedRootLabel(env: Readonly<Record<string, string | undefined>>): string | null {
  const targets = (env['RAUC_TARGET_SLOTS'] ?? '').split(/\s+/);
  for (const number of targets) {
    if (number === '' || env[`RAUC_SLOT_CLASS_${number}`] !== 'rootfs') continue;
    const label = /\/by-partlabel\/(root-[a-z]+)$/.exec(env[`RAUC_SLOT_DEVICE_${number}`] ?? '')?.[1];
    return label ?? null;
  }
  return null;
}

/**
 * The kernel command line with root= pointing at `label`. Every bundle carries one boot partition, built for slot a
 * (root=PARTLABEL=root-a); RAUC writes it into either slot, so the post-install handler points it at its own root.
 */
export function cmdlineWithRoot(line: string, label: string): string {
  const words = line
    .trim()
    .split(/\s+/)
    .filter(word => word !== '' && !word.startsWith('root='));
  const root = `root=PARTLABEL=${label}`;
  return `${[root, ...words].join(' ')}\n`;
}
