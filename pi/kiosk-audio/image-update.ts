// Updates on image Pis: the whole OS is one RAUC bundle on GitHub, installed into the slot the Pi does not run from and
// tried once on the next boot (boot-slots.ts). One code path does it for the timer, for Check for updates and Install
// on the screen (kiosk-audio), and for kiosk-rollback (kiosk-update.ts):
//
//   check    HEAD the channel's bundle URL (cheap, not the rate-limited API), read its version from the manifest only
//            when the file changed, and compare it with the booted version, the installed one and the failed ones.
//   install  rauc install, streaming from the URL, with its progress as journal lines the app turns into its bar.
//   apply    reboot with tryboot into the installed slot (04:30, Restart, or at once on the dev and branch channels).
//   health   kiosk-health.ts decides after each boot; a tried slot that is not kept is a failed version, never retried.
//
// Versions are `<ref>+<commit>` (v2.53.0+1ada1d2…, dev+1ada1d2…): the bundle manifest's version, and the booted one
// from the build's release.env.
import type { Rauc } from './rauc.ts';

const REPO = 'nvorkinn/the-max-mix';
/** The bundle's file name on every release and pre-release. */
const BUNDLE = 'the-max-mix.raucb';
/** Per-device settings (KIOSK_UPDATE_CHANNEL among them). */
export const KIOSK_ENV = '/data/the-max-mix/kiosk.env';
/** Written by the image build: KIOSK_RELEASE_REF and KIOSK_RELEASE_COMMIT of the running slot. */
export const RELEASE_ENV = '/usr/lib/the-max-mix/release.env';
/** The updater's own state, on /data so both slots share it. Root writes it; kiosk-audio only reads it. */
export const STATE_FILE = '/data/the-max-mix/update/state.json';
/** Only image Pis have it; a Pi installed by Ansible updates the old way. */
export const RAUC_CONFIG = '/etc/rauc/system.conf';
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

/** Where the channel's bundle is: the latest release, or the rolling pre-release named after the channel. */
export function bundleUrl(channel: Channel): string {
  return channel === 'stable'
    ? `https://github.com/${REPO}/releases/latest/download/${BUNDLE}`
    : `https://github.com/${REPO}/releases/download/${channel}/${BUNDLE}`;
}

export interface UpdateState {
  /** An installed slot waiting for its first boot (`tried` once the tryboot reboot has begun). */
  pending: { version: string; slot: string; tried: boolean } | null;
  /** Versions that did not pass their first boot, newest last: never installed again. */
  failed: string[];
  /** The bundle last inspected, so an unchanged file is not read again. */
  seen: { url: string; fingerprint: string; version: string | null } | null;
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
  /** A fingerprint of the file at `url`, which changes when it is replaced; null for none (404). Rejects offline. */
  head: (url: string) => Promise<string | null>;
  /** Runs a program; rejects when it fails. */
  run: (argv: string[]) => Promise<void>;
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

/** Looks at the channel's bundle. `shouldRemember` keeps its fingerprint and version for the next check (root only). */
export async function check(io: UpdateIO, shouldRemember = false): Promise<Checked> {
  const now = await status(io);
  const url = bundleUrl(now.channel);
  let fingerprint: string | null;
  try {
    fingerprint = await io.head(url);
  } catch {
    return { ...now, result: 'unreachable', latest: null };
  }
  if (fingerprint === null) return { ...now, result: 'none', latest: null };
  const state = await readState(io);
  let latest: string | null;
  if (state.seen?.url === url && state.seen.fingerprint === fingerprint) {
    latest = state.seen.version;
  } else {
    latest = await io.rauc.inspect(url);
    if (shouldRemember) await io.writeState({ ...state, seen: { url, fingerprint, version: latest } });
  }
  let result: CheckResult = 'available';
  if (latest === null) result = 'none';
  else if (latest === now.current) result = 'up-to-date';
  else if (latest === now.installed) result = 'installed';
  else if (state.failed.includes(latest)) result = 'failed';
  return { ...now, result, latest };
}

/** Installs the channel's bundle into the other slot when it is newer; the progress goes to the log as it comes. */
async function install(io: UpdateIO): Promise<Checked> {
  const checked = await check(io, true);
  if (checked.result !== 'available' || checked.latest === null) return checked;
  io.log(`Installing ${checked.latest}.`);
  let shown = -1;
  await io.rauc.install(bundleUrl(checked.channel), ({ percent, message }) => {
    if (percent === shown) return;
    shown = percent;
    io.log(`Update progress: ${percent}% ${message}`.trimEnd());
  });
  // The rolling dev bundle may have been replaced since the check: RAUC knows what it put in.
  const booted = await io.rauc.bootSlot();
  const slot = (await io.rauc.slots()).find(found => found.bootname !== null && found.bootname !== booted);
  if (!slot?.bootname) throw new Error('RAUC installed the update into no other slot.');
  const version = slot.bundleVersion ?? checked.latest;
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
  await io.run([SYSTEMCTL, 'reboot', '0 tryboot']);
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
  if (!pending?.tried) return 'normal';
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
  await io.run([SYSTEMCTL, 'reboot', '0 tryboot']);
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
