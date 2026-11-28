// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BLOCK, codedNumber, FRAME_BYTES, flacFrame, flacHeader, RATE } from './flac.ts';

describe('FLAC for the tablet stream', () => {
  it('codes frame numbers as FLAC does, like UTF-8', () => {
    const hex = (value: number) => Buffer.from(codedNumber(value)).toString('hex');
    expect(hex(0x7f)).toBe('7f');
    expect(hex(0x80)).toBe('c280');
    expect(hex(0x8_00)).toBe('e0a080');
    expect(hex(0x1_00_00)).toBe('f0908080');
    expect(hex(0x20_00_00)).toBe('f888808080');
    expect(hex(0x4_00_00_00)).toBe('fc8480808080');
  });

  it('starts with a STREAMINFO block for 44.1 kHz 16-bit stereo', () => {
    const header = flacHeader();
    expect(header.subarray(0, 4).toString()).toBe('fLaC');
    expect(header.readUInt8(4)).toBe(0x80);
    expect(header.readUIntBE(5, 3)).toBe(34);
    expect(header.readUInt16BE(8)).toBe(BLOCK);
    const packed = header.readBigUInt64BE(18);
    expect(Number(packed >> 44n)).toBe(RATE);
    expect(Number((packed >> 41n) & 7n)).toBe(1);
    expect(Number((packed >> 36n) & 31n)).toBe(15);
  });

  it('puts each channel verbatim, big-endian, with the header and frame checksums', () => {
    const pcm = Buffer.alloc(FRAME_BYTES);
    pcm.writeInt16LE(0x12_34, 0);
    pcm.writeInt16LE(-2, 2);
    const frame = flacFrame(pcm, 0);
    expect([...frame.subarray(0, 5)]).toEqual([0xff, 0xf8, 0xc9, 0x18, 0x00]);
    // CRC-8 of the header bytes above.
    expect(frame[5]).toBe(0xc2);
    expect(frame[6]).toBe(0x02);
    expect(frame.readInt16BE(7)).toBe(0x12_34);
    expect(frame[7 + BLOCK * 2]).toBe(0x02);
    expect(frame.readInt16BE(8 + BLOCK * 2)).toBe(-2);
    expect(frame).toHaveLength(6 + 2 * (1 + BLOCK * 2) + 2);
  });
});
