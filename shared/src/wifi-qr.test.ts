import { describe, expect, it } from 'vitest';
import { wifiQrText } from './wifi-qr.ts';

describe('shared/wifi-qr', () => {
  it('writes the text a phone camera joins a network from', () => {
    expect(wifiQrText('THE MAX MIX setup', 'ABCD2345EF')).toBe('WIFI:T:WPA;S:THE MAX MIX setup;P:ABCD2345EF;;');
  });

  it('escapes what the format treats as separators', () => {
    expect(wifiQrText(String.raw`a;b,c:d"e\f`, 'p;w')).toBe(String.raw`WIFI:T:WPA;S:a\;b\,c\:d\"e\\f;P:p\;w;;`);
  });
});
