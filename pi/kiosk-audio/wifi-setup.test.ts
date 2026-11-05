// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_HTML, wifiSetupAsset } from './wifi-setup.ts';

describe('wifiSetupAsset', () => {
  it('serves the page', async () => {
    await expect(wifiSetupAsset('/wifi-setup?can-cancel=1')).resolves.toEqual({
      type: 'text/html; charset=utf-8',
      body: PAGE_HTML
    });
  });

  it('serves the page script as plain JavaScript', async () => {
    const asset = await wifiSetupAsset('/wifi-setup/page.js');
    expect(asset?.type).toBe('text/javascript; charset=utf-8');
    expect(asset?.body).toMatch(/export function startPage\(doc\s*,\s*canCancel\s*\)/);
    expect(asset?.body).not.toContain('interface Network');
  });

  it('serves the sign-in keyboard the Ansible role built', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'wifi-setup-'));
    const file = path.join(folder, 'keyboard.js');
    await writeFile(file, 'export function start() {}');
    try {
      await expect(wifiSetupAsset('/wifi-setup/keyboard.js', file)).resolves.toEqual({
        type: 'text/javascript; charset=utf-8',
        body: 'export function start() {}'
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('knows nothing else', async () => {
    await expect(wifiSetupAsset('/wifi-setup/other.js')).resolves.toBeNull();
  });
});
