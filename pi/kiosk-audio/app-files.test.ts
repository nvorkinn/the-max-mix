import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appFiles, fileFor } from './app-files.ts';

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});

/** A release folder with an index.html and one hashed script, and a `current` link to it. */
async function release(): Promise<{ current: string; folder: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'app-files-'));
  folders.push(root);
  const folder = path.join(root, 'releases', 'abc1234');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  await writeFile(path.join(folder, 'index.html'), '<p>app</p>');
  await writeFile(path.join(folder, 'assets', 'index-1a2b3c.js'), 'console.log(1)');
  await writeFile(path.join(folder, 'logo.svg'), '<svg/>');
  const current = path.join(root, 'current');
  await symlink(folder, current);
  return { current, folder };
}

describe('fileFor', () => {
  it('maps / to index.html and other paths into the folder', () => {
    expect(fileFor('/app', '/')).toBe('/app/index.html');
    expect(fileFor('/app', '/?kiosk=1&pi_ref=v1.2.3')).toBe('/app/index.html');
    expect(fileFor('/app', '/assets/index-1a2b3c.js')).toBe('/app/assets/index-1a2b3c.js');
  });

  it('refuses paths that leave the folder, hidden files and paths with no extension', () => {
    expect(fileFor('/app', '/../etc/passwd')).toBeNull();
    expect(fileFor('/app', '/%2e%2e/etc/passwd')).toBeNull();
    expect(fileFor('/app', '/.env')).toBeNull();
    expect(fileFor('/app', '/settings')).toBeNull();
    expect(fileFor('/app', '/%E0%A4%A')).toBeNull();
  });
});

describe('appFiles', () => {
  it('serves the files, hashed ones to keep and the rest to check again', async () => {
    const { current } = await release();
    const files = appFiles(current);
    const page = await files('/');
    expect(page?.type).toBe('text/html; charset=utf-8');
    expect(page?.cache).toBe('no-cache');
    expect(page?.body.toString()).toBe('<p>app</p>');
    const script = await files('/assets/index-1a2b3c.js');
    expect(script?.type).toBe('text/javascript; charset=utf-8');
    expect(script?.cache).toBe('public, max-age=31536000, immutable');
    expect((await files('/logo.svg'))?.type).toBe('image/svg+xml');
    expect(await files('/assets/missing.js')).toBeNull();
  });

  it('keeps serving the release it started with when `current` moves', async () => {
    const { current, folder } = await release();
    const files = appFiles(current);
    expect(await files('/')).not.toBeNull();
    const next = path.join(path.dirname(folder), 'def5678');
    await mkdir(next);
    await writeFile(path.join(next, 'index.html'), '<p>new</p>');
    await rm(current);
    await symlink(next, current);
    expect((await files('/'))?.body.toString()).toBe('<p>app</p>');
  });

  it('serves nothing without a folder', async () => {
    expect(await appFiles('')('/')).toBeNull();
    expect(await appFiles('/nowhere/at/all')('/')).toBeNull();
  });
});
