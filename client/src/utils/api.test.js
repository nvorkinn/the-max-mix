import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestJSON, postJSON } from './api.js';
import { defined } from '../test/defined.js';

/**
 * @param {unknown} body
 * @param {{ ok?: boolean, status?: number, headers?: Record<string, string> }} [options]
 */
function mockResponse(body, { ok = true, status = 200, headers = {} } = {}) {
  return { ok, status, json: () => Promise.resolve(body), headers: new Headers(headers) };
}

/** @typedef {{ signal: AbortSignal, method: string, headers: Record<string, string>, body: string }} FetchOptions */

/** The stubbed global fetch, typed as a vitest mock. */
const fetchMock = () =>
  /** @type {import('vitest').Mock<(url: string, options: FetchOptions) => unknown>} */ (
    /** @type {unknown} */ (fetch)
  );

describe('api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns parsed JSON on success and passes a timeout signal', async () => {
    fetchMock().mockResolvedValue(mockResponse({ hello: 'world' }));
    await expect(requestJSON('/api/info')).resolves.toEqual({ hello: 'world' });
    const [url, options] = defined(fetchMock().mock.calls[0]);
    expect(url).toBe('/api/info');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws with the server error message, status and retryAfter', async () => {
    fetchMock().mockResolvedValue(
      mockResponse({ error: 'Slow down' }, { ok: false, status: 429, headers: { 'Retry-After': '7' } })
    );
    await expect(requestJSON('/x')).rejects.toMatchObject({ message: 'Slow down', status: 429, retryAfter: 7 });
  });

  it('falls back to a generic message and zero retryAfter', async () => {
    fetchMock().mockResolvedValue(mockResponse({}, { ok: false, status: 500 }));
    await expect(requestJSON('/x')).rejects.toMatchObject({
      message: 'Request failed (500).',
      status: 500,
      retryAfter: 0
    });
  });

  it('postJSON sends a JSON body with the right headers', async () => {
    fetchMock().mockResolvedValue(mockResponse({ ok: true }));
    await postJSON('/api/spotify/seek', { position_ms: 5 });
    const [, options] = defined(fetchMock().mock.calls[0]);
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toEqual({ position_ms: 5 });
  });

  it('postJSON defaults to an empty object body', async () => {
    fetchMock().mockResolvedValue(mockResponse({}));
    await postJSON('/x');
    expect(defined(fetchMock().mock.calls[0])[1].body).toBe('{}');
  });
});
