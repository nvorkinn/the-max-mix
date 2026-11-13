import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { build } from './build.ts';

describe('build', () => {
  let destination = '';

  afterEach(async () => {
    await rm(destination, { recursive: true, force: true });
  });

  it('writes plain JavaScript and the manifest, and reports a second run as unchanged', async () => {
    destination = await mkdtemp(path.join(tmpdir(), 'kiosk-keyboard-'));
    const app = 'https://app.example';
    expect(await build(import.meta.dirname, destination, app)).toEqual([
      'manifest.json',
      'loader.js',
      'keyboard.js',
      'background.js',
      'sign-out.js',
      'back.js'
    ]);

    const keyboard = await readFile(path.join(destination, 'keyboard.js'), 'utf8');
    expect(keyboard).toContain('export function start(');
    expect(keyboard).not.toContain('export type');
    const loader = await readFile(path.join(destination, 'loader.js'), 'utf8');
    expect(loader).not.toContain('declare const');
    const manifest = JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8')) as {
      content_scripts: { js: string[]; exclude_matches?: string[] }[];
    };
    // The back button stays off the app itself and off the kiosk's own pages (the Wi-Fi setup).
    const back = manifest.content_scripts.find(script => script.js.includes('back.js'));
    expect(back?.exclude_matches).toEqual(['http://127.0.0.1/*', 'https://app.example/*']);
    const keys = manifest.content_scripts.find(script => script.js.includes('loader.js'));
    expect(keys?.exclude_matches).toBeUndefined();

    expect(await build(import.meta.dirname, destination, app)).toEqual([]);
  });

  it('runs the sign-out relay on the app’s pages when given the app’s origin', async () => {
    destination = await mkdtemp(path.join(tmpdir(), 'kiosk-keyboard-'));
    await build(import.meta.dirname, destination, 'https://app.example');
    const manifest = JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8')) as {
      content_scripts: { matches: string[]; js: string[] }[];
    };
    expect(manifest.content_scripts).toContainEqual(
      expect.objectContaining({ matches: ['https://app.example/*'], js: ['sign-out.js'] })
    );
    await expect(build(import.meta.dirname, destination, 'https://app.example/path')).rejects.toThrow('Not an origin');
  });

  it('has no back button without the app’s origin, as it could not be kept off the app', async () => {
    destination = await mkdtemp(path.join(tmpdir(), 'kiosk-keyboard-'));
    await build(import.meta.dirname, destination);
    const manifest = JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8')) as {
      content_scripts: { js: string[] }[];
    };
    expect(manifest.content_scripts.map(script => script.js)).toEqual([['loader.js']]);
  });
});
