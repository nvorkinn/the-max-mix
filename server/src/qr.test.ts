/* eslint-disable sonarjs/no-clear-text-protocols -- the hotspot's address and page are plain http on a private address, by design */
import { describe, expect, it } from 'vitest';
import { wifiQrText } from '../../shared/src/wifi-qr.ts';
import { qrRows } from './qr.ts';

describe('server/qr', () => {
  it('makes a square of 0 and 1 with the finder patterns in three corners', async () => {
    const rows = await qrRows('http://10.42.0.1/');
    const size = rows.length;
    expect(size).toBeGreaterThanOrEqual(21);
    expect(rows.every(row => row.length === size && /^[01]+$/.test(row))).toBe(true);
    const finder = '1111111';
    expect(rows[0]?.startsWith(finder)).toBe(true);
    expect(rows[0]?.endsWith(finder)).toBe(true);
    expect(rows[size - 1]?.startsWith(finder)).toBe(true);
  });

  it('makes a bigger code for more text', async () => {
    const short = await qrRows('a');
    const long = await qrRows(wifiQrText('THE MAX MIX setup', 'ABCD2345EF'));
    expect(long.length).toBeGreaterThan(short.length);
  });
});
