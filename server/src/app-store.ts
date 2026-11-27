// The apps on /data, for image-update.ts's Apps: a release that changed only the app (the web app and kiosk-server)
// reaches a Pi as a small signed archive instead of a whole bundle. Each lives in /data/the-max-mix/apps/<version>, with
// an `over` file naming the slot release it was put over. `current` and `previous` link to the one in use and the one
// before it, and a `trial` file is there while a new one is being tried. /run/the-max-mix/app names the app in use:
// the image's app-select sets it at boot from these, and the updater changes it (root only; kiosk-server only reads).
import { createHash, verify, X509Certificate } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebStream } from 'node:stream/web';
import type { Apps } from './image-update.ts';

const APPS = '/data/the-max-mix/apps';
/** The app in use (image/rootfs/usr/local/lib/the-max-mix/app-select). */
const IN_USE = '/run/the-max-mix/app';
const BUILT_IN = '/opt/the-max-mix';
/** The certificate the bundles are signed for; the app's manifest is signed with the same key. */
const KEYRING = '/etc/rauc/keyring.pem';
const LOCK = '/run/the-max-mix/updating';
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
/** Versions are `<ref>+<commit>`; anything else is not used as a folder name. */
const VERSION = /^\w[\w.+-]*$/;

/** Runs a program with fixed arguments; rejects when it fails (image-update-io.ts runProgram). */
type Run = (argv: string[]) => Promise<void>;

function folder(version: string): string {
  if (!VERSION.test(version)) throw new Error(`${version} is not a version.`);
  return path.join(APPS, version);
}

/** The version a link names, when its folder holds an app; null otherwise. */
async function linked(link: string): Promise<string | null> {
  try {
    const target = await realpath(link);
    return path.dirname(target) === APPS && VERSION.test(path.basename(target)) ? path.basename(target) : null;
  } catch {
    return null;
  }
}

/** Points `link` at `target` in one step; with no target the link goes. */
async function relink(link: string, target: string | null): Promise<void> {
  if (target === null) {
    await rm(link, { force: true });
    return;
  }
  await mkdir(path.dirname(link), { recursive: true, mode: 0o755 });
  await rm(`${link}.new`, { force: true });
  await symlink(target, `${link}.new`);
  await rename(`${link}.new`, link);
}

/** Whether `signature` is `text`'s, by a certificate in RAUC's keyring. */
async function isSigned(text: string, signature: Buffer): Promise<boolean> {
  const pem = await readFile(KEYRING, 'utf8');
  const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  return certificates.some(certificate => {
    try {
      return verify('sha256', Buffer.from(text), new X509Certificate(certificate).publicKey, signature);
    } catch {
      return false;
    }
  });
}

/** Downloads `url` to `file`; resolves to its size and SHA-256. */
async function download(url: string, file: string): Promise<{ size: number; sha256: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}.`);
  const hash = createHash('sha256');
  let size = 0;
  await pipeline(
    Readable.fromWeb(response.body as WebStream),
    async function* (chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        hash.update(chunk);
        size += chunk.length;
        yield chunk;
      }
    },
    createWriteStream(file, { mode: 0o600 })
  );
  return { size, sha256: hash.digest('hex') };
}

/**
 * Downloads the archive, checks it against the signed manifest and unpacks it as `version`. The folder appears under
 * its name only once it is whole and on the card.
 */
async function fetchApp(
  run: Run,
  url: string,
  expected: { sha256: string; size: number },
  version: string,
  over: string
): Promise<void> {
  const target = folder(version);
  const unpacked = path.join(APPS, '.new');
  const archive = path.join(APPS, '.new.tar.gz');
  await mkdir(APPS, { recursive: true, mode: 0o755 });
  await rm(unpacked, { recursive: true, force: true });
  try {
    const got = await download(url, archive);
    if (got.size !== expected.size || got.sha256 !== expected.sha256) {
      throw new Error('The app archive is not the one its manifest names.');
    }
    await mkdir(unpacked, { mode: 0o755 });
    await run([
      '/usr/bin/tar',
      '--extract',
      '--gzip',
      '--no-same-owner',
      `--file=${archive}`,
      `--directory=${unpacked}`
    ]);
    await writeFile(path.join(unpacked, 'over'), `${over}\n`, { mode: 0o644 });
    await rm(target, { recursive: true, force: true });
    await rename(unpacked, target);
    await run(['/usr/bin/sync', '--file-system', APPS]);
  } finally {
    await rm(archive, { force: true });
    await rm(unpacked, { recursive: true, force: true });
  }
}

/** Removes every app but those in `keep`, and what a broken download left. */
async function prune(keep: string[]): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(APPS, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    return;
  }
  await Promise.all(
    names.filter(name => !keep.includes(name)).map(name => rm(path.join(APPS, name), { recursive: true, force: true }))
  );
}

/** Whether the process that wrote the lock still runs. */
async function isLockHeld(): Promise<boolean> {
  try {
    process.kill(Number(await readFile(LOCK, 'utf8')), 0);
    return true;
  } catch {
    return false;
  }
}

async function didLock(): Promise<boolean> {
  await mkdir(path.dirname(LOCK), { recursive: true, mode: 0o755 });
  if (await isLockHeld()) return false;
  await rm(LOCK, { force: true });
  try {
    await writeFile(LOCK, `${process.pid}\n`, { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

export function appsOnData(run: Run): Apps {
  return {
    folder,
    inUse: () => linked(IN_USE),
    previous: () => linked(path.join(APPS, 'previous')),
    over: async version => {
      try {
        return (await readFile(path.join(folder(version), 'over'), 'utf8')).trim();
      } catch {
        return null;
      }
    },
    isTrial: async () => {
      try {
        await readFile(path.join(APPS, 'trial'));
        return true;
      } catch {
        return false;
      }
    },
    setTrial: async isTrial => {
      const marker = path.join(APPS, 'trial');
      if (!isTrial) {
        await rm(marker, { force: true });
        return;
      }
      await mkdir(APPS, { recursive: true, mode: 0o755 });
      await writeFile(marker, '', { flush: true });
    },
    isSigned,
    fetch: (url, expected, version, over) => fetchApp(run, url, expected, version, over),
    use: async (version, previous) => {
      await relink(path.join(APPS, 'previous'), previous === null ? null : folder(previous));
      await relink(path.join(APPS, 'current'), version === null ? null : folder(version));
      await relink(IN_USE, version === null ? BUILT_IN : folder(version));
    },
    prune,
    lock: didLock,
    unlock: () => rm(LOCK, { force: true })
  };
}
