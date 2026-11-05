import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDebugLog, getDebugEntries } from './debugLog';
import {
  getHttpLogMode,
  getMutedHttpGroups,
  groupOf,
  HTTP_GROUPS,
  installHttpLog,
  setHttpGroupMuted,
  setHttpLogMode
} from './httpLog';

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

  describe('muting kinds of call', () => {
    it('sorts a call into its kind', () => {
      const api = 'https://api.spotify.com/v1';
      const kiosk = 'http://127.0.0.1:7341';
      expect(groupOf(`${api}/me/player`, 'GET')).toBe('spotify-playback');
      expect(groupOf(`${api}/me/player`, 'PUT')).toBe('spotify');
      expect(groupOf(`${api}/me/player/queue`, 'GET')).toBe('spotify-queue');
      expect(groupOf(`${api}/me/player/pause`, 'PUT')).toBe('spotify');
      expect(groupOf('https://accounts.spotify.com/api/token', 'POST')).toBe('spotify');
      expect(groupOf(`${kiosk}/speakers`, 'GET')).toBe('kiosk-speakers');
      expect(groupOf(`${kiosk}/heartbeat`, 'POST')).toBe('kiosk-heartbeat');
      expect(groupOf(`${kiosk}/log`, 'POST')).toBe('kiosk-heartbeat');
      expect(groupOf(`${kiosk}/lyrics?title=a&artist=b`, 'GET')).toBe('lyrics');
      expect(groupOf('https://lrclib.net/api/get-cached?track_name=a', 'GET')).toBe('lyrics');
      expect(groupOf(`${kiosk}/bluetooth/devices`, 'GET')).toBe('kiosk');
      expect(groupOf('https://api.github.com/repos/a/b', 'GET')).toBe('other');
      expect(groupOf('/relative/path', 'GET')).toBe('other');
      expect(groupOf('http://[bad', 'GET')).toBe('other');
    });

    it('has a distinct id for every kind, and the last one takes everything', () => {
      expect(new Set(HTTP_GROUPS.map(group => group.id)).size).toBe(HTTP_GROUPS.length);
      expect(HTTP_GROUPS.at(-1)?.matches(new URL('https://example.com/'), 'GET')).toBe(true);
    });

    it('remembers what is muted, and tolerates unavailable storage', () => {
      expect([...getMutedHttpGroups()]).toEqual([]);
      setHttpGroupMuted('spotify-playback', true);
      setHttpGroupMuted('kiosk-speakers', true);
      expect([...getMutedHttpGroups()]).toEqual(['spotify-playback', 'kiosk-speakers']);
      setHttpGroupMuted('spotify-playback', false);
      expect([...getMutedHttpGroups()]).toEqual(['kiosk-speakers']);
      setHttpGroupMuted('kiosk-speakers', false);
      expect(localStorage.getItem('maxmix.httpLogMuted')).toBeNull();

      localStorage.setItem('maxmix.httpLogMuted', '{"not":"a list"}');
      expect([...getMutedHttpGroups()]).toEqual([]);
      localStorage.setItem('maxmix.httpLogMuted', '[1,"lyrics"]');
      expect([...getMutedHttpGroups()]).toEqual(['lyrics']);
      localStorage.setItem('maxmix.httpLogMuted', 'not json');
      expect([...getMutedHttpGroups()]).toEqual([]);

      const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      expect(() => {
        setHttpGroupMuted('lyrics', true);
      }).not.toThrow();
      blocked.mockRestore();
    });

    it('still makes a muted call, without logging it, and logs the others', async () => {
      setHttpLogMode('calls');
      setHttpGroupMuted('spotify-playback', true);
      const response = await fetch('https://api.spotify.com/v1/me/player');
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getDebugEntries()).toHaveLength(0);

      await fetch('https://api.spotify.com/v1/me/player/queue');
      expect(messages()[0]).toBe('→ GET https://api.spotify.com/v1/me/player/queue');
      setHttpGroupMuted('spotify-playback', false);
      await fetch('https://api.spotify.com/v1/me/player');
      expect(messages().some(message => message.includes('/v1/me/player (') || message.endsWith('/v1/me/player'))).toBe(
        true
      );
    });

    it('does not log a muted call that fails, but lets the failure through', async () => {
      setHttpLogMode('calls');
      setHttpGroupMuted('other', true);
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(fetch('https://example.com/a')).rejects.toThrow('Failed to fetch');
      expect(getDebugEntries()).toHaveLength(0);
    });
  });
});
