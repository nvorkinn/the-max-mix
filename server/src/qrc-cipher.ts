// Decrypts the word-timed lyrics QQ Music sends ("QRC", see lyrics-sources.ts): hex text that is Triple DES and then
// zlib. QQ's DES is not the standard one, so Node's crypto cannot do it: it reads each four bytes of a block and of the
// key from the last one, the second key half is taken one bit off, and two S-box entries differ (the 15 at [1][7] of
// the second box and the 10 at [3][5] of the fourth). Every one of those has to be kept for the text to come out.
import { inflateSync } from 'node:zlib';

const KEY = Buffer.from('!@#)(*$%123ZXC!@!@#)(NHL', 'latin1');
const BLOCK = 8;

// prettier-ignore
const S_BOXES: readonly (readonly number[])[] = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
    4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5,
    0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
    13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
    10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
    4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
    9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
    1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
    7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11]
];
// prettier-ignore
const ROUND_PERMUTATION = [15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9,
  1, 7, 23, 13, 31, 26, 2, 8, 18, 12, 29, 5, 21, 10, 3, 24];
const KEY_SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
// prettier-ignore
const KEY_HALF_C = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35];
// prettier-ignore
const KEY_HALF_D = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3];
// prettier-ignore
const KEY_COMPRESSION = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1,
  40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31];

/** Bit `index` of `bytes`, where each four bytes are counted from their last one. */
const byteBit = (bytes: Uint8Array, index: number): number =>
  ((bytes[Math.floor(index / 32) * 4 + 3 - Math.floor((index % 32) / 8)] ?? 0) >> (7 - (index % 8))) & 1;

/** Bit `index` of a 32-bit `word`, counted from its highest one. */
const wordBit = (word: number, index: number): number => (word >>> (31 - index)) & 1;

/** The 16 round keys of one eight-byte DES key, each as the eight six-bit numbers its S-boxes take. */
function roundKeys(key: Uint8Array, isDecrypting: boolean): number[][] {
  let c = 0;
  let d = 0;
  for (let index = 0; index < 28; index += 1) {
    c |= byteBit(key, KEY_HALF_C[index] ?? 0) << (31 - index);
    d |= byteBit(key, KEY_HALF_D[index] ?? 0) << (31 - index);
  }
  const keys: number[][] = [];
  for (const [round, shift] of KEY_SHIFTS.entries()) {
    c = ((c << shift) | (c >>> (28 - shift))) & 0xff_ff_ff_f0;
    d = ((d << shift) | (d >>> (28 - shift))) & 0xff_ff_ff_f0;
    const roundKey = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const [index, from] of KEY_COMPRESSION.entries()) {
      // 27 where DES has 28: QQ's own.
      const bit = index < 24 ? wordBit(c, from) : wordBit(d, from - 27);
      const box = Math.floor(index / 6);
      roundKey[box] = (roundKey[box] ?? 0) | (bit << (5 - (index % 6)));
    }
    keys[isDecrypting ? 15 - round : round] = roundKey;
  }
  return keys;
}

/** DES's round function: `half` widened to 48 bits, mixed with the round key, through the S-boxes, then permuted. */
function feistel(half: number, roundKey: readonly number[]): number {
  let boxed = 0;
  for (const [box, sBox] of S_BOXES.entries()) {
    let six = 0;
    for (let index = 0; index < 6; index += 1) six = (six << 1) | wordBit(half, (box * 4 + index + 31) % 32);
    six ^= roundKey[box] ?? 0;
    // An S-box's row is the first and last of the six bits, its column the four between.
    boxed = (boxed << 4) | (sBox[(six & 0x20) | ((six & 0x1f) >> 1) | ((six & 1) << 4)] ?? 0);
  }
  let permuted = 0;
  for (const [index, from] of ROUND_PERMUTATION.entries()) permuted |= wordBit(boxed, from) << (31 - index);
  return permuted;
}

/** One DES pass over the eight-byte `block`, in place. */
function crypt(block: Uint8Array, keys: readonly number[][]): void {
  let left = 0;
  let right = 0;
  for (let index = 0; index < 32; index += 1) {
    const from = 57 + 2 * Math.floor(index / 8) - 8 * (index % 8);
    left |= byteBit(block, from) << (31 - index);
    right |= byteBit(block, from - 1) << (31 - index);
  }
  for (const [round, roundKey] of keys.entries()) {
    const mixed = feistel(right, roundKey) ^ left;
    if (round === 15) left = mixed;
    else [left, right] = [right, mixed];
  }
  for (let bit = 0; bit < BLOCK; bit += 1) {
    let byte = 0;
    for (let pair = 0; pair < 4; pair += 1) {
      byte |= (wordBit(right, bit + 8 * pair) << (7 - 2 * pair)) | (wordBit(left, bit + 8 * pair) << (6 - 2 * pair));
    }
    block[bit ^ 4] = byte;
  }
}

// Triple DES to decrypt: the three keys in reverse, the middle one encrypting.
const PASSES = [
  roundKeys(KEY.subarray(16, 24), true),
  roundKeys(KEY.subarray(8, 16), false),
  roundKeys(KEY.subarray(0, 8), true)
];

/** The text of QQ Music's encrypted lyrics (hex); throws when `hex` is not that. */
export function decryptQrc(hex: string): string {
  const data = Buffer.from(hex, 'hex');
  if (data.length === 0 || data.length % BLOCK !== 0) throw new Error('QQ Music sent lyrics that cannot be decrypted');
  for (let offset = 0; offset < data.length; offset += BLOCK) {
    const block = data.subarray(offset, offset + BLOCK);
    for (const keys of PASSES) crypt(block, keys);
  }
  const text = inflateSync(data).toString('utf8');
  // Without the byte order mark some of them start with.
  return text.codePointAt(0) === 0xfe_ff ? text.slice(1) : text;
}
