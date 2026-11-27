import { describe, expect, it } from 'vitest';
import { wifiQrText } from '../../server/src/qr';
import { parseWifiQr } from './wifiQr';

describe('parseWifiQr', () => {
  it('reads the code an iPhone shares', () => {
    expect(parseWifiQr('WIFI:S:Home Network;T:WPA;P:correct horse;;')).toEqual({
      ssid: 'Home Network',
      password: 'correct horse',
      hidden: false,
      security: 'psk'
    });
  });

  it('reads the code an Android phone shares, for a WPA3 and a hidden network', () => {
    expect(parseWifiQr('WIFI:T:SAE;S:Attic;P:battery staple;H:true;;')).toEqual({
      ssid: 'Attic',
      password: 'battery staple',
      hidden: true,
      security: 'psk'
    });
  });

  it('reads back what the kiosk writes for its hotspot, special characters and all', () => {
    const ssid = 'Café; "the" one, here: \\o/';
    const password = 'p;a:s,s"w\\ord';
    expect(parseWifiQr(wifiQrText(ssid, password))).toEqual({ ssid, password, hidden: false, security: 'psk' });
  });

  it('takes a network without a password as open', () => {
    expect(parseWifiQr('WIFI:T:nopass;S:Library;P:;;')?.security).toBe('open');
    expect(parseWifiQr('WIFI:S:Library;;')?.security).toBe('open');
  });

  it('goes by the password when the code gives no type', () => {
    expect(parseWifiQr('WIFI:S:Home;P:12345678;;')?.security).toBe('psk');
  });

  it('marks WEP and company sign-ins as not supported', () => {
    expect(parseWifiQr('WIFI:T:WEP;S:Old;P:abcde;;')?.security).toBe('unsupported');
    expect(parseWifiQr('WIFI:T:WPA2-EAP;S:Office;E:PEAP;I:me;P:secret;;')?.security).toBe('unsupported');
  });

  it('drops the quotes some phones put around the name and password', () => {
    expect(parseWifiQr('WIFI:T:WPA;S:"Home";P:"12345678";;')).toMatchObject({ ssid: 'Home', password: '12345678' });
  });

  it('accepts lower case and a missing end', () => {
    expect(parseWifiQr('wifi:t:wpa;s:Home;p:12345678')).toMatchObject({ ssid: 'Home', password: '12345678' });
  });

  it('is null for anything else', () => {
    expect(parseWifiQr('https://example.com/')).toBeNull();
    expect(parseWifiQr('WIFI:T:WPA;P:12345678;;')).toBeNull();
    expect(parseWifiQr('')).toBeNull();
  });
});
