import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { setBrightness, validBrightness, isFadeAsked } from './backlight.ts';

/** A backlight folder for one test, removed after it, with a panel of this full brightness in it. */
async function backlight(max?: string): Promise<{ folder: string; level: () => Promise<string> }> {
  const folder = await mkdtemp(path.join(tmpdir(), 'backlight-'));
  onTestFinished(() => rm(folder, { recursive: true, force: true }));
  const panel = path.join(folder, '11-0045');
  if (max !== undefined) {
    await mkdir(panel);
    await writeFile(path.join(panel, 'max_brightness'), `${max}\n`);
    await writeFile(path.join(panel, 'brightness'), `${max}\n`);
  }
  return { folder, level: () => readFile(path.join(panel, 'brightness'), 'utf8') };
}

describe('validBrightness', () => {
  it('takes a whole percentage from 1 to 100', () => {
    expect(validBrightness({ percent: 1 })).toBe(1);
    expect(validBrightness({ percent: 100 })).toBe(100);
  });

  it('refuses anything else', () => {
    for (const body of [null, {}, { percent: 0 }, { percent: 101 }, { percent: 50.5 }, { percent: '50' }, 50]) {
      expect(validBrightness(body)).toBeNull();
    }
  });
});

describe('isFadeAsked', () => {
  it('is only for "fade": true', () => {
    expect(isFadeAsked({ percent: 40, fade: true })).toBe(true);
    for (const body of [null, { percent: 40 }, { percent: 40, fade: 'yes' }, { percent: 40, fade: false }]) {
      expect(isFadeAsked(body)).toBe(false);
    }
  });
});

describe('setBrightness', () => {
  it('sets the panel to that share of its own full brightness', async () => {
    const { folder, level } = await backlight('255');
    expect(await setBrightness(40, folder)).toBe(1);
    expect(await level()).toBe('102');
    expect(await setBrightness(100, folder)).toBe(1);
    expect(await level()).toBe('255');
  });

  it('fades there in steps, and a newer change stops the fade', async () => {
    const { folder, level } = await backlight('200');
    const levels: string[] = [];
    const fading = setBrightness(10, folder, 500);
    // Watch the level go down on the way.
    // A read can land between the fade's truncate and its write (the real backlight file has no such gap), and finds it
    // empty: read again then.
    const look = async () => {
      await new Promise(resolve => setTimeout(resolve, 60));
      let read = '';
      while (read === '') read = (await level()).trim();
      levels.push(read);
    };
    await look();
    await look();
    await look();
    await look();
    expect(Number(levels[0])).toBeLessThan(200);
    expect(Number(levels[3])).toBeLessThan(Number(levels[0]));
    expect(Number(levels[3])).toBeGreaterThan(20);
    // A tap brightens it at once, and the fade leaves it there.
    expect(await setBrightness(100, folder)).toBe(1);
    expect(await fading).toBe(1);
    expect(await level()).toBe('200');
  });

  it('never turns the backlight off', async () => {
    const { folder, level } = await backlight('31');
    expect(await setBrightness(1, folder)).toBe(1);
    expect(await level()).toBe('1');
  });

  it('sets nothing on a screen with no backlight', async () => {
    const { folder } = await backlight();
    expect(await setBrightness(40, folder)).toBe(0);
    expect(await setBrightness(40, path.join(folder, 'none'))).toBe(0);
  });

  it('leaves a backlight that does not say how bright it goes', async () => {
    const { folder, level } = await backlight('unknown');
    expect(await setBrightness(40, folder)).toBe(0);
    expect(await level()).toBe('unknown\n');
  });
});
