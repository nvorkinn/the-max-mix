import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { screenInfo } from './screen.ts';

/** Empty drm and backlight folders for one test, removed after it. */
async function folders(): Promise<{ root: string; drm: string; backlight: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'screen-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const drm = path.join(root, 'drm');
  const backlight = path.join(root, 'backlight');
  await mkdir(drm);
  await mkdir(backlight);
  return { root, drm, backlight };
}

async function connector(drm: string, name: string, status: string, modes: string[]): Promise<void> {
  await mkdir(path.join(drm, name));
  await writeFile(path.join(drm, name, 'status'), `${status}\n`);
  await writeFile(path.join(drm, name, 'modes'), modes.map(mode => `${mode}\n`).join(''));
}

describe('screenInfo', () => {
  it('reads the-max-mix: an HDMI 1280x800 panel on HDMI-A-2, with no backlight', async () => {
    const { drm, backlight } = await folders();
    // As the-max-mix's /sys/class showed it on 2026-11-21.
    await connector(drm, 'card1-HDMI-A-1', 'disconnected', []);
    await connector(drm, 'card1-HDMI-A-2', 'connected', ['1280x800', '1920x1080']);
    await connector(drm, 'card1-Writeback-1', 'unknown', []);

    expect(await screenInfo(drm, backlight)).toEqual({ width: 1280, height: 800, brightness_control: false });
  });

  it('can set the brightness of a DSI panel, which has a backlight', async () => {
    const { drm, backlight } = await folders();
    await connector(drm, 'card1-DSI-1', 'connected', ['1024x600']);
    await mkdir(path.join(backlight, '11-0045'));

    expect(await screenInfo(drm, backlight)).toEqual({ width: 1024, height: 600, brightness_control: true });
  });

  it('knows no screen when none is connected or the connected one lists no mode', async () => {
    const { drm, backlight } = await folders();
    await connector(drm, 'card1-HDMI-A-1', 'disconnected', ['1280x800']);
    await connector(drm, 'card1-HDMI-A-2', 'connected', []);

    expect(await screenInfo(drm, backlight)).toBeNull();
  });

  it('knows no screen without the kernel folders', async () => {
    const { root } = await folders();
    expect(await screenInfo(path.join(root, 'none'), path.join(root, 'none'))).toBeNull();
  });
});
