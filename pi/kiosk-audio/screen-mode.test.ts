import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { preferredMode, screenMode } from './screen-mode.ts';

/** A base EDID block whose preferred timing is `width` x `height` with the given blanking and pixel clock (10 kHz). */
function edid(width: number, height: number, widthBlank: number, heightBlank: number, clock: number): Uint8Array {
  const block = new Uint8Array(128);
  block.set([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]);
  block.set(
    [
      clock & 0xff,
      clock >> 8,
      width & 0xff,
      widthBlank & 0xff,
      ((width >> 8) << 4) | (widthBlank >> 8),
      height & 0xff,
      heightBlank & 0xff,
      ((height >> 8) << 4) | (heightBlank >> 8)
    ],
    54
  );
  const sum = block.reduce((total, byte) => total + byte, 0);
  block[127] = (256 - (sum % 256)) % 256;
  return block;
}

// 1280x800 at 59.91 Hz (reduced blanking, 71 MHz), as on a 10.1 inch screen; 1024x600 at 60 Hz (51.2 MHz).
const TEN_INCH = edid(1280, 800, 160, 23, 7100);
const SEVEN_INCH = edid(1024, 600, 320, 35, 5120);

describe('kiosk-audio/screen-mode', () => {
  it('reads the preferred mode and rounds its refresh rate', () => {
    expect(preferredMode(TEN_INCH)).toBe('1280x800@60');
    expect(preferredMode(SEVEN_INCH)).toBe('1024x600@60');
  });

  it('ignores an EDID that is short, has no header or a bad checksum', () => {
    expect(preferredMode(new Uint8Array(0))).toBeUndefined();
    expect(preferredMode(TEN_INCH.subarray(0, 127))).toBeUndefined();
    const noHeader = new Uint8Array(TEN_INCH);
    noHeader[1] = 0;
    expect(preferredMode(noHeader)).toBeUndefined();
    const badSum = new Uint8Array(TEN_INCH);
    badSum[127] = (badSum[127] ?? 0) ^ 1;
    expect(preferredMode(badSum)).toBeUndefined();
  });

  it('ignores an EDID whose first descriptor is not a timing, or is interlaced', () => {
    expect(preferredMode(edid(0, 0, 0, 0, 0))).toBeUndefined();
    const interlaced = edid(1920, 1080, 280, 22, 7425);
    interlaced[54 + 17] = 0x80;
    interlaced[127] = ((interlaced[127] ?? 0) + 256 - 0x80) % 256;
    expect(preferredMode(interlaced)).toBeUndefined();
  });

  describe('from the DRM folder', () => {
    let drm: string;

    beforeEach(async () => {
      drm = await mkdtemp(path.join(tmpdir(), 'screen-mode-'));
    });

    afterEach(async () => {
      await rm(drm, { recursive: true, force: true });
    });

    async function port(name: string, content?: Uint8Array) {
      await mkdir(path.join(drm, name));
      if (content) await writeFile(path.join(drm, name, 'edid'), content);
    }

    it('takes the first HDMI port with a valid EDID', async () => {
      await port('card1');
      await port('card1-HDMI-A-2', SEVEN_INCH);
      await port('card1-HDMI-A-1', new Uint8Array(0));
      expect(await screenMode(drm)).toBe('1024x600@60');
      await port('card1-HDMI-A-10', TEN_INCH);
      expect(await screenMode(drm)).toBe('1024x600@60');
    });

    it('prefers HDMI-A-1', async () => {
      await port('card1-HDMI-A-2', SEVEN_INCH);
      await port('card1-HDMI-A-1', TEN_INCH);
      expect(await screenMode(drm)).toBe('1280x800@60');
    });

    it('finds nothing without a screen or a DRM folder', async () => {
      await port('card1-HDMI-A-1');
      expect(await screenMode(drm)).toBeUndefined();
      expect(await screenMode(path.join(drm, 'missing'))).toBeUndefined();
    });
  });
});
