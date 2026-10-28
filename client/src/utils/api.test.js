import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestJSON, postJSON } from './api.js';

function mockResponse(body, { ok = true, status = 200, headers = {} } = {}) {
  return { ok, status, json: async () => body, headers: new Headers(headers) };
}

describe('api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns parsed JSON on success and passes a timeout signal', async () => {
    fetch.mockResolvedValue(mockResponse({ hello: 'world' }));
    await expect(requestJSON('/api/info')).resolves.toEqual({ hello: 'world' });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/info');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws with the server error message, status and retryAfter', async () => {
    fetch.mockResolvedValue(
      mockResponse({ error: 'Slow down' }, { ok: false, status: 429, headers: { 'Retry-After': '7' } })
    );
    await expect(requestJSON('/x')).rejects.toMatchObject({ message: 'Slow down', status: 429, retryAfter: 7 });
  });

  it('falls back to a generic message and zero retryAfter', async () => {
    fetch.mockResolvedValue(mockResponse({}, { ok: false, status: 500 }));
    await expect(requestJSON('/x')).rejects.toMatchObject({
      message: 'Request failed (500).',
      status: 500,
      retryAfter: 0
    });
  });

  it('postJSON sends a JSON body with the right headers', async () => {
    fetch.mockResolvedValue(mockResponse({ ok: true }));
    await postJSON('/api/spotify/seek', { position_ms: 5 });
    const [, options] = fetch.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toEqual({ position_ms: 5 });
  });

  it('postJSON defaults to an empty object body', async () => {
    fetch.mockResolvedValue(mockResponse({}));
    await postJSON('/x');
    expect(fetch.mock.calls[0][1].body).toBe('{}');
  });
});
