// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { GET, POST } from '../sonos.ts';

const ORIGIN = 'https://the-max-mix.vercel.app';
const STATE = 'a'.repeat(32);

const post = (body: unknown, origin: string | null = ORIGIN) =>
  POST(
    new Request(`${ORIGIN}/api/sonos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin && { Origin: origin }) },
      body: JSON.stringify(body)
    })
  );

describe('api/sonos', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    vi.stubEnv('SONOS_CLIENT_ID', 'client');
    vi.stubEnv('SONOS_CLIENT_SECRET', 'secret');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends the browser to Sonos with the state and the callback address', () => {
    const reply = GET(new Request(`${ORIGIN}/api/sonos?state=${STATE}`));
    expect(reply.status).toBe(302);
    const target = new URL(reply.headers.get('location') ?? '');
    expect(target.origin + target.pathname).toBe('https://api.sonos.com/login/v3/oauth');
    expect(Object.fromEntries(target.searchParams)).toEqual({
      client_id: 'client',
      response_type: 'code',
      state: STATE,
      scope: 'playback-control-all',
      redirect_uri: `${ORIGIN}/sonos/callback`
    });
  });

  it('refuses a missing state, and says so when the app is not set up', () => {
    expect(GET(new Request(`${ORIGIN}/api/sonos`)).status).toBe(400);
    vi.stubEnv('SONOS_CLIENT_SECRET', '');
    expect(GET(new Request(`${ORIGIN}/api/sonos?state=${STATE}`)).status).toBe(503);
  });

  it('swaps a code for tokens with the secret, and passes on only what the app needs', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 86_399, scope: 'x' })
    );
    const reply = await post({ code: 'the-code' });
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 86_399 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.sonos.com/login/v3/oauth/access');
    expect(new Headers(init.headers).get('authorization')).toBe(`Basic ${btoa('client:secret')}`);
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: `${ORIGIN}/sonos/callback`
    });
  });

  it('refreshes with a refresh token', async () => {
    fetchMock.mockResolvedValue(Response.json({ access_token: 'access', expires_in: 60 }));
    expect(await (await post({ refreshToken: 'refresh' })).json()).toEqual({ accessToken: 'access', expiresIn: 60 });
    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'refresh'
    });
  });

  it('refuses other sites and bodies without a code', async () => {
    expect((await post({ code: 'x' }, 'https://evil.example')).status).toBe(403);
    expect((await post({ code: 'x' }, null)).status).toBe(403);
    expect((await post({})).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a spent code as 401 and other failures as 502', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    expect((await post({ code: 'x' })).status).toBe(401);
    fetchMock.mockResolvedValueOnce(new Response('down', { status: 500 }));
    expect((await post({ code: 'x' })).status).toBe(502);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect((await post({ code: 'x' })).status).toBe(502);
    fetchMock.mockResolvedValueOnce(Response.json({ access_token: 'access' }));
    expect((await post({ code: 'x' })).status).toBe(502);
  });
});
