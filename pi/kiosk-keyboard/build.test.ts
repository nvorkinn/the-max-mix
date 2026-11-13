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
    expect(await build(import.meta.dirname, destination)).toEqual([
      'manifest.json',
      'loader.js',
      'keyboard.js',
      'background.js',
      'sign-out.js'
    ]);

    const keyboard = await readFile(path.join(destination, 'keyboard.js'), 'utf8');
    expect(keyboard).toMatch(/export function start\(doc\s*, mount\s*= doc.documentElement\)/);
    expect(keyboard).not.toContain('export type');
    const loader = await readFile(path.join(destination, 'loader.js'), 'utf8');
    expect(loader).not.toContain('declare const');
    const manifest = JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8')) as { name: string };
    expect(manifest.name).toBe('THE MAX MIX sign-in keyboard');

    expect(await build(import.meta.dirname, destination)).toEqual([]);
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
});
