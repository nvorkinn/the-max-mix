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
  const STORAGE_TYPES = 'cookies,local_storage,indexeddb,cache_storage,service_workers,file_systems';

  it('clears every cookie, then the storage of each site with one through a page', async () => {
    const sent: [string, Record<string, unknown> | undefined, string | undefined][] = [];
    const forgotten = await forgetSites((method, params, sessionId) => {
      sent.push([method, params, sessionId]);
      if (method === 'Storage.getCookies') return Promise.resolve({ cookies: [{ domain: '.spotify.com' }] });
      if (method === 'Target.getTargets') {
        return Promise.resolve({
          targetInfos: [
            { targetId: 'worker', type: 'service_worker' },
            { targetId: 'app', type: 'page' }
          ]
        });
      }
      if (method === 'Target.attachToTarget') return Promise.resolve({ sessionId: 'session' });
      return Promise.resolve({});
    });
    expect(sent).toEqual([
      ['Storage.getCookies', undefined, undefined],
      ['Storage.clearCookies', undefined, undefined],
      ['Target.getTargets', undefined, undefined],
      ['Target.attachToTarget', { targetId: 'app', flatten: true }, undefined],
      ['Storage.clearDataForOrigin', { origin: 'https://spotify.com', storageTypes: STORAGE_TYPES }, 'session'],
      ['Target.detachFromTarget', { sessionId: 'session' }, undefined]
    ]);
    expect(forgotten).toEqual({ cookies: 1, sites: 1, sitesCleared: 1 });
  });

  it('keeps the cookies cleared when Chromium refuses to clear a site', async () => {
    const sent: string[] = [];
    const forgotten = await forgetSites(method => {
      sent.push(method);
      if (method === 'Storage.getCookies') {
        return Promise.resolve({ cookies: [{ domain: '.spotify.com' }, { domain: 'accounts.spotify.com' }] });
      }
      if (method === 'Target.getTargets') return Promise.resolve({ targetInfos: [{ targetId: 'app', type: 'page' }] });
      if (method === 'Target.attachToTarget') return Promise.resolve({ sessionId: 'session' });
      if (method === 'Storage.clearDataForOrigin') return Promise.reject(new Error('Internal error'));
      return Promise.resolve({});
    });
    expect(sent.slice(0, 2)).toEqual(['Storage.getCookies', 'Storage.clearCookies']);
    expect(forgotten).toEqual({ cookies: 2, sites: 2, sitesCleared: 0 });
  });

  it('clears the cookies when there is no page to clear the sites through', async () => {
    const forgotten = await forgetSites(method => {
      if (method === 'Storage.getCookies') return Promise.resolve({ cookies: [{ domain: '.spotify.com' }] });
      if (method === 'Target.getTargets') return Promise.reject(new Error('Internal error'));
      return Promise.resolve({});
    });
    expect(forgotten).toEqual({ cookies: 1, sites: 1, sitesCleared: 0 });
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
