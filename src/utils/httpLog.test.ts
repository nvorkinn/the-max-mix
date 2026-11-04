import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDebugLog, getDebugEntries } from './debugLog';
import { getHttpLogMode, installHttpLog, setHttpLogMode } from './httpLog';

const fetchMock = vi.fn();
const messages = () => getDebugEntries().map(entry => entry.message);

describe('httpLog', () => {
  beforeAll(() => {
    // Installed once, over the mock, the way the app wraps the real fetch at start-up.
    vi.stubGlobal('fetch', fetchMock);
    installHttpLog();
    installHttpLog();
  });
  beforeEach(() => {
    localStorage.clear();
    clearDebugLog();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200, headers: { 'X-Seen': 'yes' } }));
  });
  afterEach(() => localStorage.clear());

  it('remembers the setting and tolerates unavailable storage', () => {
    expect(getHttpLogMode()).toBe('off');
    setHttpLogMode('headers');
    expect(getHttpLogMode()).toBe('headers');
    setHttpLogMode('calls');
    expect(getHttpLogMode()).toBe('calls');
    setHttpLogMode('off');
    expect(localStorage.getItem('maxmix.httpLog')).toBeNull();
    const broken = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getHttpLogMode()).toBe('off');
    broken.mockRestore();
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => setHttpLogMode('calls')).not.toThrow();
    blocked.mockRestore();
  });

  it('logs nothing while off, and still makes the call', async () => {
    const response = await fetch('https://example.com/a');
    expect(response.status).toBe(200);
    expect(getDebugEntries()).toHaveLength(0);
  });

  it('logs the request and the response, without headers', async () => {
    setHttpLogMode('calls');
    await fetch('https://example.com/a', { method: 'put', headers: { Authorization: 'Bearer secret' } });
    const [request, response] = messages();
    expect(request).toBe('→ PUT https://example.com/a');
    expect(response).toMatch(/^← 200 PUT https:\/\/example\.com\/a \(\d+ ms\)$/);
  });

  it('adds the headers, hiding the ones that carry credentials', async () => {
    setHttpLogMode('headers');
    await fetch('https://example.com/a?code=abc&limit=5', {
      headers: { Authorization: 'Bearer secret', 'X-Plain': 'visible' }
    });
    const [request, response] = messages();
    expect(new URL(request?.split(' ', 3)[2] ?? '').searchParams.get('code')).toBe('[redacted]');
    expect(request).toContain('limit=5');
    expect(request).toContain('authorization: [redacted]');
    expect(request).toContain('x-plain: visible');
    expect(request).not.toContain('secret');
    expect(response).toContain('x-seen: yes');
  });

  it('says so when no headers are readable, and takes a Request object', async () => {
    setHttpLogMode('headers');
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await fetch(new Request('https://example.com/b', { method: 'POST', headers: { Cookie: 'a=1' } }));
    await fetch(new URL('https://example.com/c'));
    const [first, second] = messages();
    expect(first).toContain('→ POST https://example.com/b');
    expect(first).toContain('cookie: [redacted]');
    expect(second).toContain('(none readable)');
    expect(messages()).toHaveLength(4);
  });

  it('marks failed responses as warnings and rejections as errors', async () => {
    setHttpLogMode('calls');
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 429 }));
    await fetch('https://example.com/limit');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetch('https://example.com/down')).rejects.toThrow('Failed to fetch');
    const entries = getDebugEntries();
    expect(entries[1]).toMatchObject({ level: 'warn' });
    expect(entries[1]?.message).toContain('← 429');
    expect(entries[3]).toMatchObject({ level: 'error' });
    expect(entries[3]?.message).toMatch(/^✕ GET https:\/\/example\.com\/down failed after \d+ ms: /);
  });
});
