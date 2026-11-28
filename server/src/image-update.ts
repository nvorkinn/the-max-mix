// Updates on image Pis: the whole OS is one RAUC bundle on GitHub, installed into the slot the Pi does not run from and
// tried once on the next boot (boot-slots.ts). One code path does it for the timer, for Check for updates and Install
// on the screen (kiosk-server), and for kiosk-rollback (kiosk-update.ts):
//
//   check    read the channel's bundle.txt (cheap, not the rate-limited API), which names its bundle, read the bundle's
//            version from its manifest only when that changed, and compare it with the booted version, the installed one
//            and the failed ones.
//   install  rauc install, streaming from the URL, with its progress as journal lines the app turns into its bar.
//   apply    reboot with tryboot into the installed slot, at once (or at 04:30 or on Restart if that failed).
//   health   kiosk-health.ts decides after each boot; a tried slot that is not kept is a failed version, never retried.
//
// A release that changed only the app (the web app and kiosk-server) skips all that. Each bundle has the app on its own
// beside it, with a signed manifest that names the OS it goes with (image/build.sh, KIOSK_RELEASE_OS). When that is the
// running slot's, install only downloads and unpacks the app onto /data (app-store.ts), and apply changes over to it
// and restarts the kiosk, with no reboot: the health check runs at once, and a failed one changes back.
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
/**
 * The Pi's own lines for the boot firmware's config.txt, such as the dtoverlay of a screen the firmware does not find by
 * itself. Every slot's config.txt comes from the image, so they are written into it (configWithOwn).
 */
export const OWN_CONFIG = '/data/the-max-mix/config.txt';
/** Written by the image build: KIOSK_RELEASE_REF, KIOSK_RELEASE_COMMIT and KIOSK_RELEASE_OS of the running slot. */
export const RELEASE_ENV = '/usr/lib/the-max-mix/release.env';
/** The same of the app in use, when that is a newer one on /data; the image's own app has none. */
export const APP_RELEASE_ENV = '/run/the-max-mix/app/release.env';
/** The updater's own state, on /data so both slots share it. Root writes it; kiosk-server only reads it. */
export const STATE_FILE = '/data/the-max-mix/update/state.json';
/** The timer runs every 2 minutes; a Pi on the stable channel checks only this often. */
export const STABLE_EVERY_MS = 6 * 60 * 60 * 1000;
/** How many failed versions are remembered. */
const MAX_FAILED = 10;
const SYSTEMCTL = '/usr/bin/systemctl';
const NODE = '/usr/bin/node';
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

/** The app on its own, as its signed manifest beside the bundle names it. */
export interface AppManifest {
  version: string;
  /** KIOSK_RELEASE_OS of the bundle it was built with. */
  os: string;
  sha256: string;
  size: number;
}

/** The apps on /data (app-store.ts); tests pass fakes. Only `inUse` is for kiosk-server; the rest needs root. */
export interface Apps {
  /** Where `version` is unpacked. */
  folder: (version: string) => string;
  /** The app in use: a version on /data, or null for the image's own. */
  inUse: () => Promise<string | null>;
  /** The app that was in use before the one on /data now, when that was one on /data too. */
  previous: () => Promise<string | null>;
  /** The slot release `version` was put over; null when it is not there. */
  over: (version: string) => Promise<string | null>;
  /** Whether a new app was being tried and nothing settled it (the Pi went down meanwhile). */
  isTrial: () => Promise<boolean>;
  setTrial: (isTrial: boolean) => Promise<void>;
  /** Whether `signature` is `text`'s, by the key the bundles are signed with. */
  isSigned: (text: string, signature: Buffer) => Promise<boolean>;
  /** Downloads the archive at `url`, checks its size and hash, and unpacks it as `version`, put over `over`. */
  fetch: (url: string, expected: { sha256: string; size: number }, version: string, over: string) => Promise<void>;
  /** Makes `version` the app in use (null: the image's own), and notes the one before it. Programs keep theirs until restarted. */
  use: (version: string | null, previous: string | null) => Promise<void>;
  /** Removes every app on /data but these. */
  prune: (keep: string[]) => Promise<void>;
  /** One updater at a time: false when another holds the lock. */
  lock: () => Promise<boolean>;
  unlock: () => Promise<void>;
}

export interface UpdateState {
  /**
   * An installed slot waiting for its first boot (`tried` once the tryboot reboot has begun). With `over`, it is an
   * app on /data waiting for the kiosk's restart instead: `over` is the slot release it was put over, and `slot` is
   * empty.
   */
  pending: { version: string; slot: string; tried: boolean; over?: string } | null;
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
  /** Saves the state (root only: kiosk-server never calls it). */
  writeState: (state: UpdateState) => Promise<void>;
  /** The text of a small file at `url`; null for none (404). Rejects offline. */
  fetchText: (url: string) => Promise<string | null>;
  /** The same for a small binary file. */
  fetchBytes: (url: string) => Promise<Buffer | null>;
  apps: Apps;
  /** Waits for the kiosk to come up (health.ts): null when it did, else what is wrong. */
  health: () => Promise<string | null>;
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

/** What a release.env says: the version it names (null when it does not say) and the OS it goes with. */
async function release(
  io: Pick<UpdateIO, 'readText'>,
  file: string
): Promise<{ version: string | null; os: string | null }> {
  const env = parseEnv((await io.readText(file)) ?? '');
  const ref = env['KIOSK_RELEASE_REF'];
  const commit = env['KIOSK_RELEASE_COMMIT'];
  return { version: ref && commit ? `${ref}+${commit}` : null, os: env['KIOSK_RELEASE_OS'] ?? null };
}

/** The running version: the app in use when it came on its own, else the slot's, from the build's release.env. */
async function bootedVersion(io: Pick<UpdateIO, 'readText'>): Promise<string | null> {
  return (await release(io, APP_RELEASE_ENV)).version ?? (await release(io, RELEASE_ENV)).version;
}

/** A manifest's fields, or null when it is not one. */
export function parseManifest(text: string): AppManifest | null {
  try {
    const { version, os, sha256, size } = JSON.parse(text) as Partial<Record<keyof AppManifest, unknown>>;
    const isValid =
      typeof version === 'string' &&
      typeof os === 'string' &&
      typeof sha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(sha256) &&
      typeof size === 'number';
    return isValid ? { version, os, sha256, size } : null;
  } catch {
    return null;
  }
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

/**
 * What it takes to get `latest` without its bundle: the archive of its app, when the release differs from the running
 * slot's in the app alone, or nothing at all (`url` null) when it is the slot's own release. Null when the bundle is
 * needed: the OS differs, the release has no app on its own, or its manifest is not properly signed.
 */
async function appAlone(
  io: UpdateIO,
  bundle: string,
  latest: string,
  slot: { version: string | null; os: string | null }
): Promise<{ url: string | null; manifest: AppManifest | null } | null> {
  if (slot.version === null) return null;
  if (latest === slot.version) return { url: null, manifest: null };
  if (slot.os === null) return null;
  const stem = bundle.slice(0, -'.raucb'.length);
  const text = await io.fetchText(`${stem}.app.json`);
  const signature = text === null ? null : await io.fetchBytes(`${stem}.app.json.sig`);
  if (text === null || signature === null) return null;
  if (!(await io.apps.isSigned(text, signature))) {
    io.log('The app on its own is not signed with the update key, so the whole bundle is installed.');
    return null;
  }
  const manifest = parseManifest(text);
  return manifest?.version === latest && manifest.os === slot.os ? { url: `${stem}.app.tar.gz`, manifest } : null;
}

/** Puts `version`'s app on /data, checks that its updater starts, and notes it as waiting for the kiosk's restart. */
async function installApp(
  io: UpdateIO,
  app: { url: string | null; manifest: AppManifest | null },
  version: string,
  over: string
): Promise<void> {
  io.log(`Installing ${version} (only the app changed).`);
  if (app.url !== null && app.manifest !== null) {
    io.log('Update progress: 10% Downloading the app');
    await io.apps.fetch(app.url, app.manifest, version, over);
    io.log('Update progress: 80% Checking the app');
    // The updater is part of the app: one that cannot even look for updates would leave the Pi with no way forward.
    await io.run([NODE, `${io.apps.folder(version)}/server/src/kiosk-update.ts`, 'check']);
  }
  io.log('Update progress: 100% Installing done.');
  await io.writeState({ ...(await readState(io)), pending: { version, slot: '', tried: false, over } });
  io.log(`Installed ${version}. It starts with the next restart.`);
}

/** Changes over to an app (null: the image's own) and restarts what runs it: kiosk-server and the kiosk. */
async function changeOver(io: UpdateIO, version: string | null, previous: string | null): Promise<void> {
  await io.apps.use(version, previous);
  try {
    await io.run([SYSTEMCTL, '--user', '--machine=kiosk@', 'restart', 'kiosk-server.service']);
  } catch {
    // The kiosk user's session is not up: kiosk.service starts it, and kiosk-server with it.
  }
  await io.run([SYSTEMCTL, 'restart', 'kiosk.service']);
}

/**
 * Changes over to the app that waits and restarts the kiosk, then gives it the health check a new slot gets after its
 * boot. Not healthy: back to the app before it, and the version is never installed again.
 */
async function applyApp(
  io: UpdateIO,
  state: UpdateState,
  pending: NonNullable<UpdateState['pending']>
): Promise<'restarting' | 'none'> {
  const slot = (await release(io, RELEASE_ENV)).version;
  if (slot === null || pending.over !== slot) {
    // The Pi runs another slot than the one this app was put over.
    await io.writeState({ ...state, pending: null });
    return 'none';
  }
  const before = await io.apps.inUse();
  const older = await io.apps.previous();
  const next = pending.version === slot ? null : pending.version;
  await io.writeState({ ...state, pending: { ...pending, tried: true } });
  io.log(RESTART_LINE);
  await io.apps.setTrial(true);
  let wrong: string | null;
  try {
    await changeOver(io, next, before);
    wrong = await io.health();
  } catch (error) {
    // A kiosk that does not even restart is not healthy either.
    wrong = error instanceof Error ? error.message : String(error);
  }
  if (wrong === null) {
    await io.apps.setTrial(false);
    await io.apps.prune([next, before].filter(version => version !== null));
    await io.writeState({ ...(await readState(io)), pending: null });
    io.log(`Kept ${pending.version}.`);
    return 'restarting';
  }
  io.log(`Not healthy: ${wrong}`);
  io.log(`Going back to the previous version; ${pending.version} is not installed again.`);
  await changeOver(io, before, older);
  await io.apps.setTrial(false);
  await io.writeState({ ...withFailed(await readState(io), pending.version), pending: null });
  return 'restarting';
}

/** Installs the channel's bundle into the other slot when it is newer; the progress goes to the log as it comes. */
async function install(io: UpdateIO): Promise<Checked> {
  const { checked, url } = await look(io, true);
  if (url === null || checked.latest === null || checked.result !== 'available') return checked;
  const own = await release(io, RELEASE_ENV);
  const app = await appAlone(io, url, checked.latest, own);
  if (app !== null && own.version !== null) {
    await installApp(io, app, checked.latest, own.version);
    return { ...checked, result: 'installed', installed: checked.latest };
  }
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

/**
 * Reboots once into the installed slot (tryboot) when one waits, or changes over to the app that waits and restarts
 * the kiosk: 'restarting', or 'none' when nothing waits.
 */
export async function apply(io: UpdateIO): Promise<'restarting' | 'none'> {
  const state = await readState(io);
  if (!state.pending || state.pending.tried) return 'none';
  if (state.pending.over !== undefined) return applyApp(io, state, state.pending);
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
 * The timer (`isScheduled`) and the screen's Install: check, install anything newer, and restart into it at once. A
 * stable Pi's timer checks every 6 hours only.
 */
export async function run(io: UpdateIO, isScheduled: boolean): Promise<Checked | null> {
  const channel = await readChannel(io);
  if (isScheduled) {
    const state = await readState(io);
    if (channel === 'stable' && state.checkedAt !== null && io.now() - state.checkedAt < STABLE_EVERY_MS) return null;
    await io.writeState({ ...state, checkedAt: io.now() });
  }
  if ((await io.rauc.operation()) !== 'idle' || !(await io.apps.lock())) {
    io.log('An update is already being installed.');
    return null;
  }
  try {
    const done = await install(io);
    if (done.result === 'installed') await apply(io);
    if (done.result === 'up-to-date') io.log(`Up to date (${done.current ?? 'unknown version'}).`);
    if (done.result === 'failed') {
      io.log(`${done.latest ?? ''} failed on this Pi before, so it is not installed again.`);
    }
    return done;
  } finally {
    await io.apps.unlock();
  }
}

/**
 * Settles an app on /data that was being tried, or waited, when the Pi went down. One still marked as on trial never
 * passed its health check: the image's app-select already left it aside at this boot, and it counts as failed.
 */
async function settleApp(io: UpdateIO): Promise<void> {
  const state = await readState(io);
  const pending = state.pending?.over === undefined ? null : state.pending;
  if (await io.apps.isTrial()) {
    const inUse = await io.apps.inUse();
    await io.apps.use(inUse, null);
    await io.apps.setTrial(false);
    if (pending === null) return;
    io.log(`${pending.version} was still being tried when the Pi went down. It is not installed again.`);
    await io.writeState({ ...withFailed(state, pending.version), pending: null });
    return;
  }
  if (!pending?.tried) return;
  // The change-over ended, and only the note was left behind.
  const isKept = (await bootedVersion(io)) === pending.version;
  await io.writeState({ ...(isKept ? state : withFailed(state, pending.version)), pending: null });
}

/**
 * At each boot, before the health check: settles what happened to a tried update. Returns 'trial' when this boot is
 * the first of a newly installed slot (the health check decides whether it stays), otherwise 'normal'. A tried slot the
 * Pi did not come back up on (a hang, a panic, a failed health check) is a failed version.
 */
export async function afterBoot(io: UpdateIO): Promise<'trial' | 'normal'> {
  await settleApp(io);
  const state = await readState(io);
  const pending = state.pending;
  // A trial boot counts even with no note, e.g. after an install by hand with `rauc install`. An app that waits on
  // /data has nothing to do with the boot.
  if (!pending?.tried || pending.over !== undefined) return (await io.isTrialBoot()) ? 'trial' : 'normal';
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
 * When the running app came on its own, the previous version is the app before it, with no reboot. The version left
 * behind counts as failed, so the timer does not put it back.
 */
export async function rollback(io: UpdateIO): Promise<void> {
  const inUse = await io.apps.inUse();
  if (inUse !== null) {
    // The version before this one differed in the app alone: back to that app, or to the image's own.
    const slot = (await release(io, RELEASE_ENV)).version;
    const previous = await io.apps.previous();
    const back = previous !== null && previous !== inUse && (await io.apps.over(previous)) === slot ? previous : null;
    await io.writeState({ ...withFailed(await readState(io), inUse), pending: null });
    io.log(`Going back from ${inUse} to ${back ?? slot ?? 'the previous version'}.`);
    await changeOver(io, back, null);
    return;
  }
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

const OWN_START = `# The Pi's own settings, from ${OWN_CONFIG}. Edit them there: kiosk-update writes them here.`;
const OWN_END = "# The end of the Pi's own settings.";

/**
 * The boot firmware's config.txt with the Pi's own lines (`own`, OWN_CONFIG's content) at its end, under [all], in
 * place of the ones written there before; without any when `own` has none.
 */
export function configWithOwn(config: string, own: string): string {
  const kept: string[] = [];
  let isOwn = false;
  for (const line of config.replaceAll('\r\n', '\n').split('\n')) {
    if (line === OWN_START) isOwn = true;
    else if (line === OWN_END) isOwn = false;
    else if (!isOwn) kept.push(line);
  }
  const image = kept.join('\n').trimEnd();
  const lines = own
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
  return lines.length === 0 ? `${image}\n` : `${image}\n\n${OWN_START}\n[all]\n${lines.join('\n')}\n${OWN_END}\n`;
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
