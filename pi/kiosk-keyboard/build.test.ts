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
    expect(await build(import.meta.dirname, destination)).toEqual(['manifest.json', 'loader.js', 'keyboard.js']);

    const keyboard = await readFile(path.join(destination, 'keyboard.js'), 'utf8');
    expect(keyboard).toMatch(/export function start\(doc\s*\)/);
    expect(keyboard).not.toContain('export type');
    const loader = await readFile(path.join(destination, 'loader.js'), 'utf8');
    expect(loader).not.toContain('declare const');
    const manifest = JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8')) as { name: string };
    expect(manifest.name).toBe('THE MAX MIX sign-in keyboard');

    expect(await build(import.meta.dirname, destination)).toEqual([]);
  });
});
