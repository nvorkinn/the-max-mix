import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cmdlineWithMode,
  correctScreens,
  evenTimings,
  FALLBACK_MODE,
  modeSetting,
  preferredMode,
  screenMode,
  writeCmdlineMode
} from './screen-mode.ts';

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
// What a 10.1 inch screen (an MPI107) sends: 1280x800 at 63.6 Hz (80 MHz), its sync pulse 45 pixels wide from 88 pixels
// into the blanking, so the sync ends at pixel 1413, which the Pi 4 cannot send.
const ODD_TEN_INCH = Uint8Array.from(
  Buffer.from(
    '00ffffffffffff0036090110008888881c1c0103800000780a0dc9a05747982712484c000000d1c0010101010101010101010101' +
      '0101401f00c850203230582d450000205300001e000000100080107020208400803874000018000000fc004d50493130370a2020' +
      '202020200000001000147801ff1d000a2020202020200095',
    'hex'
  )
);
// The kernel command line of an image's boot partition, before the kiosk adds the screen mode.
const IMAGE_CMDLINE =
  'console=serial0,115200 console=tty3 root=PARTLABEL=root-a rootfstype=ext4 ro rootwait quiet logo.nologo loglevel=3';
const sumOf = (block: Uint8Array) => block.reduce((total, byte) => total + byte, 0) % 256;

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

  it('makes an odd sync pulse even, and leaves the rest of the EDID as it was', () => {
    expect(preferredMode(ODD_TEN_INCH)).toBe('1280x800@64');
    const even = evenTimings(ODD_TEN_INCH);
    expect(even?.[54 + 9]).toBe(44);
    expect(sumOf(even ?? new Uint8Array(1))).toBe(0);
    expect(preferredMode(even ?? new Uint8Array(0))).toBe('1280x800@64');
    const changed = Array.from(ODD_TEN_INCH, (byte, index) => (byte === even?.[index] ? -1 : index));
    expect(changed.filter(index => index >= 0)).toEqual([54 + 9, 127]);
    // Once corrected there is nothing left to do.
    expect(evenTimings(even ?? new Uint8Array(0))).toBeUndefined();
  });

  it('makes an odd front porch and odd blanking even too', () => {
    const odd = edid(1280, 800, 201, 50, 8000);
    odd.set([0x59, 0x2d], 54 + 8);
    odd[127] = (256 - sumOf(odd.subarray(0, 127))) % 256;
    const even = evenTimings(odd) ?? new Uint8Array(0);
    // 201 of blanking becomes 202, the front porch 89 becomes 90 and the pulse 45 becomes 44.
    expect([even[54 + 3], even[54 + 8], even[54 + 9]]).toEqual([202, 90, 44]);
    expect(sumOf(even)).toBe(0);
  });

  it('leaves alone a mode that is even already, an odd width and an EDID that is not valid', () => {
    expect(evenTimings(TEN_INCH)).toBeUndefined();
    expect(evenTimings(SEVEN_INCH)).toBeUndefined();
    const oddWidth = edid(1281, 800, 200, 50, 8000);
    oddWidth.set([0x58, 0x2d], 54 + 8);
    oddWidth[127] = (256 - sumOf(oddWidth.subarray(0, 127))) % 256;
    expect(evenTimings(oddWidth)).toBeUndefined();
    expect(evenTimings(ODD_TEN_INCH.subarray(0, 100))).toBeUndefined();
  });

  describe('cmdlineWithMode', () => {
    it('forces the mode on both HDMI ports, after the other parameters', () => {
      expect(cmdlineWithMode(IMAGE_CMDLINE, '1280x800@60')).toBe(
        `${IMAGE_CMDLINE} video=HDMI-A-1:1280x800@60 video=HDMI-A-2:1280x800@60`
      );
    });

    it('replaces another mode once the mode is known', () => {
      const line = `${IMAGE_CMDLINE} video=HDMI-A-1:1024x600@60 video=HDMI-A-2:1024x600@60 video=DSI-1:800x480@60`;
      expect(cmdlineWithMode(line, '1280x800@60')).toBe(
        `${IMAGE_CMDLINE} video=DSI-1:800x480@60 video=HDMI-A-1:1280x800@60 video=HDMI-A-2:1280x800@60`
      );
    });

    it('keeps the mode set when the mode is not known, and falls back to the 7 inch one without any', () => {
      const line = `${IMAGE_CMDLINE} video=HDMI-A-1:1280x800@60 video=HDMI-A-2:1280x800@60`;
      expect(cmdlineWithMode(line, undefined)).toBe(line);
      expect(cmdlineWithMode(`  ${IMAGE_CMDLINE}\n`, undefined)).toBe(
        `${IMAGE_CMDLINE} video=HDMI-A-1:${FALLBACK_MODE} video=HDMI-A-2:${FALLBACK_MODE}`
      );
    });

    it('takes only a mode as a setting', () => {
      expect(modeSetting(' 1280x800@60 ')).toBe('1280x800@60');
      expect(modeSetting('')).toBeUndefined();
      expect(modeSetting(undefined)).toBeUndefined();
      expect(modeSetting('1280x800')).toBeUndefined();
      expect(modeSetting('1280x800@60 quiet')).toBeUndefined();
    });
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

    it('gives the kernel the corrected EDID of the screen that needs one, and has it read that screen again', async () => {
      const debug = path.join(drm, 'debug');
      await port('card1-HDMI-A-1');
      await port('card1-HDMI-A-2', ODD_TEN_INCH);
      await port('card0-HDMI-A-3', SEVEN_INCH);
      await mkdir(path.join(debug, '1', 'HDMI-A-2'), { recursive: true });

      expect(await correctScreens(drm, debug)).toEqual(['HDMI-A-2']);
      const override = await readFile(path.join(debug, '1', 'HDMI-A-2', 'edid_override'));
      expect(Uint8Array.from(override)).toEqual(evenTimings(ODD_TEN_INCH));
      expect(await readFile(path.join(drm, 'card1-HDMI-A-2', 'status'), 'utf8')).toBe('detect');
      // The kernel now reports the corrected EDID, so a second run changes nothing.
      await writeFile(path.join(drm, 'card1-HDMI-A-2', 'edid'), override);
      expect(await correctScreens(drm, debug)).toEqual([]);
      expect(await correctScreens(path.join(drm, 'missing'), debug)).toEqual([]);
    });

    it("writes the screen's own mode into the kernel command line, and a setting over it", async () => {
      await port('card1-HDMI-A-1', TEN_INCH);
      const cmdline = path.join(drm, 'cmdline.txt');
      await writeFile(cmdline, `${IMAGE_CMDLINE}\n`);

      expect(await writeCmdlineMode(cmdline, { drm })).toBe(
        `${IMAGE_CMDLINE} video=HDMI-A-1:1280x800@60 video=HDMI-A-2:1280x800@60`
      );
      // Right already: the file is left alone.
      expect(await writeCmdlineMode(cmdline, { drm })).toBeUndefined();
      expect(await writeCmdlineMode(cmdline, { drm, setting: '1024x600@60' })).toBe(
        `${IMAGE_CMDLINE} video=HDMI-A-1:1024x600@60 video=HDMI-A-2:1024x600@60`
      );
      expect(await readFile(cmdline, 'utf8')).toBe(
        `${IMAGE_CMDLINE} video=HDMI-A-1:1024x600@60 video=HDMI-A-2:1024x600@60\n`
      );
    });
  });
});
