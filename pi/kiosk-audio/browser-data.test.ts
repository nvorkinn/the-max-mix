// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cookieOrigins, forgetSites } from './browser-data.ts';

describe('cookieOrigins', () => {
  it('names each site once, leaving out the kiosk’s own', () => {
    expect(
      cookieOrigins([
        { domain: '.spotify.com' },
        { domain: 'accounts.spotify.com' },
        { domain: 'spotify.com' },
        { domain: '127.0.0.1' },
        { domain: '.apple.com' },
        { domain: '' }
      ])
    ).toEqual(['https://accounts.spotify.com', 'https://apple.com', 'https://spotify.com']);
  });
});

describe('forgetSites', () => {
  it('clears the storage of each site with a cookie, then every cookie', async () => {
    const sent: [string, Record<string, unknown> | undefined][] = [];
    await forgetSites((method, params) => {
      sent.push([method, params]);
      return Promise.resolve(method === 'Storage.getCookies' ? { cookies: [{ domain: '.spotify.com' }] } : {});
    });
    expect(sent).toEqual([
      ['Storage.getCookies', undefined],
      [
        'Storage.clearDataForOrigin',
        {
          origin: 'https://spotify.com',
          storageTypes: 'cookies,local_storage,indexeddb,cache_storage,service_workers,file_systems'
        }
      ],
      ['Storage.clearCookies', undefined]
    ]);
  });

  it('still clears the cookies when there are none to name', async () => {
    const sent: string[] = [];
    await forgetSites(method => {
      sent.push(method);
      return Promise.resolve({});
    });
    expect(sent).toEqual(['Storage.getCookies', 'Storage.clearCookies']);
  });
});
