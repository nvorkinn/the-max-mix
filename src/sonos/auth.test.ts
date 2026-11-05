import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

async function load() {
  vi.resetModules();
  return import('./auth');
}

const visit = (address: string) => history.replaceState(null, '', address);

describe('sonos/auth', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    visit('/');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('remembers a state and goes to the server function with it', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    const { startSonosSignIn } = await load();
    startSonosSignIn();
    const state = sessionStorage.getItem('maxmix.sonosState');
    expect(state).toMatch(/^[0-9a-f]{48}$/);
    expect(assign).toHaveBeenCalledWith(`/api/sonos?state=${state}`);
  });

  it('ignores any address other than the callback', async () => {
    visit('/?code=spotify-code&state=x');
    const { completeSonosSignIn, isSonosCallback } = await load();
    expect(isSonosCallback()).toBe(false);
    await completeSonosSignIn();
    expect(location.search).toBe('?code=spotify-code&state=x');
  });

  it('swaps the code for a refresh token, stores it and goes back to the start page', async () => {
    sessionStorage.setItem('maxmix.sonosState', 'the-state');
    visit('/sonos/callback?code=the-code&state=the-state');
    fetchMock.mockResolvedValue(Response.json({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 60 }));
    const { completeSonosSignIn, isSonosSignedIn, getSonosSignInError } = await load();
    await completeSonosSignIn();
    expect(location.pathname + location.search).toBe('/');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sonos');
    expect(init.body).toBe(JSON.stringify({ code: 'the-code' }));
    expect(isSonosSignedIn()).toBe(true);
    expect(getSonosSignInError()).toBeNull();
    expect(sessionStorage.getItem('maxmix.sonosState')).toBeNull();
  });

  it('refuses a reply whose state does not match', async () => {
    sessionStorage.setItem('maxmix.sonosState', 'mine');
    visit('/sonos/callback?code=the-code&state=other');
    const { completeSonosSignIn, isSonosSignedIn, getSonosSignInError } = await load();
    await completeSonosSignIn();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isSonosSignedIn()).toBe(false);
    expect(getSonosSignInError()).toMatch(/invalid state/);
  });

  it.each([
    ['access_denied', 'Sonos sign-in was declined.'],
    ['server_error', 'Sonos sign-in failed (server_error).']
  ])('reports ?error=%s', async (error, message) => {
    visit(`/sonos/callback?error=${error}`);
    const { completeSonosSignIn, getSonosSignInError } = await load();
    await completeSonosSignIn();
    expect(getSonosSignInError()).toBe(message);
  });

  it.each([
    [Response.json({ error: 'invalid_grant' }, { status: 401 }), 'Sonos sign-in expired. Start again from Settings.'],
    [Response.json({ error: 'Sonos is not set up.' }, { status: 503 }), 'Sonos is not set up.'],
    [new Response('oops', { status: 500 }), 'Sonos sign-in failed (500).'],
    [Response.json({ accessToken: 'access' }), 'Sonos did not provide a refresh token. Sign in again.']
  ])('reports a failed exchange (%#)', async (reply, message) => {
    sessionStorage.setItem('maxmix.sonosState', 's');
    visit('/sonos/callback?code=c&state=s');
    fetchMock.mockResolvedValue(reply);
    const { completeSonosSignIn, getSonosSignInError, isSonosSignedIn } = await load();
    await completeSonosSignIn();
    expect(getSonosSignInError()).toBe(message);
    expect(isSonosSignedIn()).toBe(false);
  });

  describe('getSonosAccessToken', () => {
    const signedIn = () => localStorage.setItem('maxmix.sonosAuth', JSON.stringify({ refreshToken: 'refresh' }));

    it('is null while signed out', async () => {
      const { getSonosAccessToken } = await load();
      expect(await getSonosAccessToken()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refreshes once for concurrent callers, keeps a rotated refresh token and caches the access token', async () => {
      signedIn();
      fetchMock.mockResolvedValue(Response.json({ accessToken: 'access', refreshToken: 'rotated', expiresIn: 3600 }));
      const { getSonosAccessToken } = await load();
      expect(await Promise.all([getSonosAccessToken(), getSonosAccessToken()])).toEqual(['access', 'access']);
      expect(await getSonosAccessToken()).toBe('access');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].body).toBe(
        JSON.stringify({ refreshToken: 'refresh' })
      );
      expect(localStorage.getItem('maxmix.sonosAuth')).toBe(JSON.stringify({ refreshToken: 'rotated' }));
    });

    it('refreshes again after the token is discarded', async () => {
      signedIn();
      fetchMock.mockImplementation(() => Promise.resolve(Response.json({ accessToken: 'access', expiresIn: 3600 })));
      const { discardSonosAccessToken, getSonosAccessToken } = await load();
      await getSonosAccessToken();
      discardSonosAccessToken();
      await getSonosAccessToken();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(localStorage.getItem('maxmix.sonosAuth')).toBe(JSON.stringify({ refreshToken: 'refresh' }));
    });

    it('forgets a revoked login', async () => {
      signedIn();
      fetchMock.mockResolvedValue(Response.json({ error: 'invalid_grant' }, { status: 401 }));
      const { getSonosAccessToken, isSonosSignedIn } = await load();
      expect(await getSonosAccessToken()).toBeNull();
      expect(isSonosSignedIn()).toBe(false);
    });

    it('throws when the refresh fails for another reason, keeping the login', async () => {
      signedIn();
      fetchMock.mockResolvedValueOnce(Response.json({ error: 'Sonos could not be reached.' }, { status: 502 }));
      fetchMock.mockResolvedValueOnce(new Response('down', { status: 500 }));
      const { getSonosAccessToken, isSonosSignedIn } = await load();
      await expect(getSonosAccessToken()).rejects.toThrow('Sonos could not be reached.');
      await expect(getSonosAccessToken()).rejects.toThrow('Sonos could not be reached (500).');
      expect(isSonosSignedIn()).toBe(true);
    });

    it('drops a refresh that finishes after signing out', async () => {
      signedIn();
      let answer: (reply: Response) => void = () => {};
      fetchMock.mockReturnValue(new Promise<Response>(resolve => (answer = resolve)));
      const { getSonosAccessToken, isSonosSignedIn, signOutSonos } = await load();
      const pending = getSonosAccessToken();
      signOutSonos();
      answer(Response.json({ accessToken: 'access', refreshToken: 'rotated', expiresIn: 3600 }));
      expect(await pending).toBeNull();
      expect(isSonosSignedIn()).toBe(false);
    });
  });

  it('signs out', async () => {
    localStorage.setItem('maxmix.sonosAuth', JSON.stringify({ refreshToken: 'refresh' }));
    const { isSonosSignedIn, signOutSonos } = await load();
    expect(isSonosSignedIn()).toBe(true);
    signOutSonos();
    expect(isSonosSignedIn()).toBe(false);
    expect(localStorage.getItem('maxmix.sonosAuth')).toBeNull();
  });
});
