// FLAC as a Sonos takes it over HTTP, for the tablet's stream (tablet-stream.ts). The frames are verbatim: the 16-bit
// samples as they are, with FLAC's headers and checksums around them, so the Pi needs no encoder and spends next to no
// time on them. That is as big as uncompressed audio (about 1.4 Mbit/s at 44.1 kHz stereo), which a home network carries
// easily; a Sonos plays it as FLAC, which it did not do with an endless WAV.

/** Samples per channel in one frame (FLAC's block size code 12). */
export const BLOCK = 4096;
export const RATE = 44_100;
export const CHANNELS = 2;
/** Bytes of interleaved 16-bit stereo audio one frame holds. */
export const FRAME_BYTES = BLOCK * CHANNELS * 2;

function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80_00 ? ((crc << 1) ^ 0x80_05) & 0xff_ff : (crc << 1) & 0xff_ff;
    }
  }
  return crc;
}

const CODED_LIMITS = [0x8_00, 0x1_00_00, 0x20_00_00, 0x4_00_00_00];

/** A frame number as FLAC codes it: like UTF-8, one to six bytes. */
export function codedNumber(value: number): number[] {
  if (value < 0x80) return [value];
  const below = CODED_LIMITS.findIndex(limit => value < limit);
  const count = below === -1 ? 6 : below + 2;
  const bytes = [((0xff << (8 - count)) & 0xff) | Math.floor(value / 2 ** (6 * (count - 1)))];
  for (let place = count - 2; place >= 0; place -= 1) bytes.push(0x80 | (Math.floor(value / 2 ** (6 * place)) & 0x3f));
  return bytes;
}

/** The start of the stream: "fLaC" and a STREAMINFO block for 44.1 kHz 16-bit stereo, its length not known. */
export function flacHeader(): Buffer {
  const header = Buffer.alloc(4 + 4 + 34);
  header.write('fLaC', 0);
  // The last (and only) metadata block, STREAMINFO, 34 bytes long.
  header.writeUInt8(0x80, 4);
  header.writeUIntBE(34, 5, 3);
  header.writeUInt16BE(BLOCK, 8);
  header.writeUInt16BE(BLOCK, 10);
  // Frame sizes unknown (0), then 20 bits of sample rate, 3 of channels - 1, 5 of bits per sample - 1, and 36 of total
  // samples (0: unknown). The MD5 stays 0: none.
  header.writeBigUInt64BE((BigInt(RATE) << 44n) | (BigInt(CHANNELS - 1) << 41n) | (15n << 36n), 18);
  return header;
}

/** Frame `index` of FRAME_BYTES of interleaved little-endian 16-bit stereo audio. */
export function flacFrame(pcm: Buffer, index: number): Buffer {
  // Sync code and fixed block size; block size code 12 and 44.1 kHz; left and right apart, 16 bits; the frame number.
  const head = Buffer.from([0xff, 0xf8, 0xc9, 0x18, ...codedNumber(index)]);
  const frame = Buffer.alloc(head.length + 1 + CHANNELS * (1 + BLOCK * 2) + 2);
  head.copy(frame);
  frame[head.length] = crc8(head);
  let at = head.length + 1;
  for (let channel = 0; channel < CHANNELS; channel += 1) {
    // A VERBATIM subframe with no wasted bits, then its samples, big-endian.
    frame[at] = 0x02;
    at += 1;
    for (let sample = 0; sample < BLOCK; sample += 1) {
      frame.writeInt16BE(pcm.readInt16LE((sample * CHANNELS + channel) * 2), at);
      at += 2;
    }
  }
  frame.writeUInt16BE(crc16(frame.subarray(0, at)), at);
  return frame;
}
