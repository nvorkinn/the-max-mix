// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { GET, POST } from '../sonos-control.ts';

const ORIGIN = 'https://the-max-mix.vercel.app';
const GROUP = 'Sonos_group.1:1234';

const request = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Authorization', 'Bearer token');
  return new Request(`${ORIGIN}/api/sonos-control?${new URLSearchParams({ path })}`, { ...init, headers });
};

const write = (path: string, body: string) =>
  POST(request(path, { method: 'POST', headers: { Origin: ORIGIN }, body }));

describe('api/sonos-control', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(Response.json({ households: [{ id: 'Sonos_h.1' }] }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('relays a read with the access token and passes on the answer', async () => {
    const reply = await GET(request('/households'));
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({ households: [{ id: 'Sonos_h.1' }] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.ws.sonos.com/control/api/v1/households');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
  });

  it.each(['/households/Sonos_h.1/groups', `/groups/${GROUP}/groupVolume`])('relays GET %s', async path => {
    expect((await GET(request(path))).status).toBe(200);
  });

  it('passes on what Sonos answers, errors included', async () => {
    fetchMock.mockResolvedValue(Response.json({ errorCode: 'ERROR_NOT_AUTHORIZED' }, { status: 401 }));
    expect((await GET(request('/households'))).status).toBe(401);
    fetchMock.mockRejectedValue(new Error('offline'));
    expect((await GET(request('/households'))).status).toBe(502);
  });

  it.each(['/households/x/../../admin', '/players/x/playerVolume', 'https://evil.example/', '/households/a/b/groups'])(
    'refuses the path %s',
    async path => {
      expect((await GET(request(path))).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('refuses a call without an access token', async () => {
    const reply = await GET(new Request(`${ORIGIN}/api/sonos-control?path=/households`));
    expect(reply.status).toBe(401);
  });

  it('relays a group volume change from the app only', async () => {
    const change = (origin: string) =>
      POST(
        request(`/groups/${GROUP}/groupVolume`, {
          method: 'POST',
          headers: { Origin: origin },
          body: JSON.stringify({ volume: 30 })
        })
      );
    expect((await change('https://evil.example')).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await change(ORIGIN)).status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.ws.sonos.com/control/api/v1/groups/${GROUP}/groupVolume`);
    expect(init).toMatchObject({ method: 'POST', body: '{"volume":30}' });
  });

  it('relays a change to the rooms of a group', async () => {
    expect((await write(`/groups/${GROUP}/groups/setGroupMembers`, '{"playerIds":["a"]}')).status).toBe(200);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      `https://api.ws.sonos.com/control/api/v1/groups/${GROUP}/groups/setGroupMembers`
    );
  });

  it('refuses writes to other paths and oversized bodies', async () => {
    expect((await write('/households', '{}')).status).toBe(400);
    expect((await write(`/groups/${GROUP}/groupVolume`, 'x'.repeat(2000))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
