import { afterEach, describe, expect, it, vi } from 'vitest';
import { getUpdateStatus } from './kioskService';

afterEach(() => vi.unstubAllGlobals());

describe('getUpdateStatus', () => {
  it('reads the update status from the service', async () => {
    const status = { state: 'running', lines: ['a'], total: 1 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(status) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getUpdateStatus()).resolves.toEqual(status);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/update/status', { cache: 'no-store' });
  });

  it('is null when the service does not answer or refuses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(getUpdateStatus()).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(getUpdateStatus()).resolves.toBeNull();
  });
});
