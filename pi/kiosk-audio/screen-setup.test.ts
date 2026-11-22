import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import {
  environmentFile,
  knownScreen,
  rotationSetting,
  scaleSetting,
  screenSetup,
  touchRule
} from './screen-setup.ts';

/** An empty drm folder for one test, removed after it. */
async function drmFolder(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'screen-setup-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function connector(drm: string, name: string, status: string, modes: string[]): Promise<void> {
  await mkdir(path.join(drm, name));
  await writeFile(path.join(drm, name, 'status'), `${status}\n`);
  await writeFile(path.join(drm, name, 'modes'), modes.map(mode => `${mode}\n`).join(''));
}

/** the-max-mix-4's /sys/class/drm on 2026-11-22: a Pi 5 with the 10.1 inch Touch Display 2 on DSI-2. */
async function touchDisplay2(): Promise<string> {
  const drm = await drmFolder();
  await connector(drm, 'card0-DSI-2', 'connected', ['1200x1920']);
  await connector(drm, 'card2-HDMI-A-1', 'disconnected', []);
  await connector(drm, 'card2-HDMI-A-2', 'disconnected', []);
  await connector(drm, 'card2-Writeback-1', 'unknown', []);
  return drm;
}

describe('screenSetup', () => {
  it('turns the 10.1 inch Touch Display 2 to landscape and draws it 1.5 times as big', async () => {
    expect(await screenSetup(await touchDisplay2())).toEqual({
      name: 'Raspberry Pi Touch Display 2, 10.1 inch',
      rotation: 90,
      scale: 1.5
    });
  });

  it('leaves a screen it does not know as it is', async () => {
    const drm = await drmFolder();
    await connector(drm, 'card1-HDMI-A-2', 'connected', ['1280x800', '1920x1080']);

    expect(await screenSetup(drm)).toEqual({ rotation: 0, scale: 1 });
  });

  it('leaves the screen as it is when none is connected', async () => {
    expect(await screenSetup(await drmFolder())).toEqual({ rotation: 0, scale: 1 });
  });

  it("lets the role's settings win over the known screen's", async () => {
    expect(await screenSetup(await touchDisplay2(), { rotation: 270 })).toMatchObject({ rotation: 270, scale: 1.5 });
    expect(await screenSetup(await touchDisplay2(), { rotation: 0, scale: 1 })).toMatchObject({ rotation: 0, scale: 1 });
  });
});

describe('knownScreen', () => {
  it('needs the connector type and the mode to match', () => {
    expect(knownScreen({ connector: 'DSI-1', width: 1200, height: 1920 })?.rotation).toBe(90);
    expect(knownScreen({ connector: 'HDMI-A-1', width: 1200, height: 1920 })).toBeUndefined();
    expect(knownScreen({ connector: 'DSI-1', width: 1920, height: 1200 })).toBeUndefined();
    expect(knownScreen(null)).toBeUndefined();
  });
});

describe('settings', () => {
  it('reads an empty setting as none, so the screen decides', () => {
    expect(rotationSetting('')).toBeUndefined();
    expect(rotationSetting(undefined)).toBeUndefined();
    expect(scaleSetting('')).toBeUndefined();
  });

  it('reads the rotations and scales the kiosk can use', () => {
    expect(rotationSetting('0')).toBe(0);
    expect(rotationSetting('270')).toBe(270);
    expect(rotationSetting('45')).toBeUndefined();
    expect(scaleSetting('1.5')).toBe(1.5);
    expect(scaleSetting('0')).toBeUndefined();
    expect(scaleSetting('big')).toBeUndefined();
  });
});

describe('files', () => {
  it('writes the environment kiosk.service and kiosk-audio read', () => {
    expect(environmentFile({ rotation: 90, scale: 1.5 })).toBe('KIOSK_SCREEN_ROTATION=90\nKIOSK_SCREEN_SCALE=1.5\n');
  });

  it("turns the touches as the picture, as the-max-mix-4's hand-set rule did", () => {
    expect(touchRule({ rotation: 90, scale: 1.5 })).toContain(
      'ENV{ID_INPUT_TOUCHSCREEN}=="1", ENV{LIBINPUT_CALIBRATION_MATRIX}="0 -1 1 1 0 0"\n'
    );
    expect(touchRule({ rotation: 0, scale: 1 })).toContain('ENV{LIBINPUT_CALIBRATION_MATRIX}="1 0 0 0 1 0"');
  });
});
