import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { parseJson } from './http';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';

const app = vi.hoisted(() => ({ clientId: '', leaveFor: vi.fn<(address: string) => void>() }));

// The real client ID is a constant; tests switch it to check that a login belongs to one client ID. Leaving for
// Spotify's sign-in page is recorded instead of done: the test page cannot navigate.
vi.mock('./settings', async importOriginal => ({
  ...(await importOriginal<typeof import('./settings')>()),
  getClientId: () => app.clientId,
  leaveFor: app.leaveFor
}));

const setClientId = (clientId: string) => {
  app.clientId = clientId;
};

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** A fresh copy of the modules, so the in-memory token cache of one test cannot leak into the next. */
async function load() {
  vi.resetModules();
  const auth = await import('./auth');
  const settings = await import('./settings');
  return { ...auth, ...settings };
}

const storedJson = (key: string) => parseJson(localStorage.getItem(key) ?? 'null') as Record<string, unknown> | null;

/** The active person's login as stored, or null. */
function storedLogin() {
  const stored = storedJson('maxmix.people') as {
    clientId: string;
    activeId: string | null;
    people: { spotifyId: string; refreshToken: string }[];
  } | null;
  const person = stored?.people.find(known => known.spotifyId === stored.activeId);
  return stored && person ? { clientId: stored.clientId, refreshToken: person.refreshToken } : null;
}

const ME = { id: 'nikolai', display_name: 'Nikolai', images: [{ url: 'https://i.scdn.co/image/n' }] };

const requestOf = (fetchMock: Mock, call = 0) => fetchMock.mock.calls[call] as [string, RequestInit];

const visit = (address: string) => history.replaceState(null, '', address);

const formOf = (fetchMock: Mock, call = 0) => {
  const init = requestOf(fetchMock, call)[1];
  return new URLSearchParams(init.body as URLSearchParams);
};

describe('spotify/auth', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setClientId('');
    visit('/');
    fetchMock = vi.fn();
    // GET /me names the account; fetchMock sees the token endpoint only.
    vi.stubGlobal('fetch', (url: string, init: RequestInit) =>
      url === 'https://api.spotify.com/v1/me' ? Promise.resolve(json(ME)) : (fetchMock(url, init) as Promise<Response>)
    );
    app.leaveFor.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('startSignIn', () => {
    it('stores a verifier and state, then goes to Spotify with an S256 challenge', async () => {
      const { startSignIn } = await load();
      setClientId('client-1');

      await startSignIn();

      const url = new URL(String(app.leaveFor.mock.calls[0]?.[0]));
      expect(`${url.origin}${url.pathname}`).toBe('https://accounts.spotify.com/authorize');
      expect(url.searchParams.get('client_id')).toBe('client-1');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('redirect_uri')).toBe(`${location.origin}/`);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('scope')).toBe(
        'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-read-currently-playing user-library-read user-read-recently-played playlist-read-private'
      );
      const { state, verifier } = parseJson(sessionStorage.getItem('maxmix.pkce') ?? 'null') as {
        state: string;
        verifier: string;
      };
      expect(state).toBe(url.searchParams.get('state'));
      expect(verifier).toMatch(/^[\w-]{43,128}$/);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      const expected = btoa(String.fromCodePoint(...new Uint8Array(digest)))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
      expect(url.searchParams.get('code_challenge')).toBe(expected);
      // A first sign-in lets Spotify skip its approval page when the person has approved before.
      expect(url.searchParams.has('show_dialog')).toBe(false);
    });

    it('uses a new verifier and state every time', async () => {
      const { startSignIn } = await load();
      setClientId('client-1');
      await startSignIn();
      const first = sessionStorage.getItem('maxmix.pkce');
      await startSignIn();
      expect(sessionStorage.getItem('maxmix.pkce')).not.toBe(first);
    });

    it('refuses when session storage is blocked, since the reply could never be checked', async () => {
      const { startSignIn } = await load();
      setClientId('client-1');
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      await expect(startSignIn()).rejects.toThrow('Browser storage is blocked');
      expect(app.leaveFor).not.toHaveBeenCalled();
    });
  });

  describe('completeSignIn', () => {
    const startedSignIn = (state: string) =>
      sessionStorage.setItem('maxmix.pkce', JSON.stringify({ state, verifier: 'the-verifier' }));

    it('returns null when the address is not a sign-in reply', async () => {
      visit('/?kiosk=1');
      const { completeSignIn } = await load();
      expect(await completeSignIn()).toBeNull();
      expect(location.search).toBe('?kiosk=1');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('exchanges the code, stores the login, cleans the address and keeps other parameters', async () => {
      const { completeSignIn, isSignedIn, getAccessToken } = await load();
      setClientId('client-1');
      startedSignIn('s1');
      visit('/?kiosk=1&code=abc&state=s1#top');
      fetchMock.mockResolvedValue(json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }));

      expect(await completeSignIn()).toEqual({ ok: true });

      expect(requestOf(fetchMock)[0]).toBe(TOKEN_URL);
      const init = requestOf(fetchMock)[1];
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
      expect(Object.fromEntries(formOf(fetchMock))).toEqual({
        client_id: 'client-1',
        grant_type: 'authorization_code',
        code: 'abc',
        redirect_uri: `${location.origin}/`,
        code_verifier: 'the-verifier'
      });
      expect(storedLogin()).toEqual({
        clientId: 'client-1',
        refreshToken: 'refresh-1'
      });
      expect(sessionStorage.getItem('maxmix.pkce')).toBeNull();
      expect(`${location.pathname}${location.search}${location.hash}`).toBe('/?kiosk=1#top');
      expect(isSignedIn()).toBe(true);
      // The access token from the exchange is reused rather than refreshed at once.
      expect(await getAccessToken()).toBe('access-1');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('removes the whole query when only the reply was in it', async () => {
      const { completeSignIn } = await load();
      setClientId('client-1');
      startedSignIn('s1');
      visit('/?code=abc&state=s1');
      fetchMock.mockResolvedValue(json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }));
      await completeSignIn();
      expect(`${location.pathname}${location.search}`).toBe('/');
    });

    it('rejects a state that does not match and never calls Spotify', async () => {
      const { completeSignIn, isSignedIn } = await load();
      setClientId('client-1');
      startedSignIn('expected');
      visit('/?code=abc&state=other');
      expect(await completeSignIn()).toEqual({
        ok: false,
        error: 'Spotify sign-in expired or has an invalid state. Start again from Settings.'
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(isSignedIn()).toBe(false);
      expect(location.search).toBe('');
      expect(sessionStorage.getItem('maxmix.pkce')).toBeNull();
    });

    it('rejects a reply with no state', async () => {
      const { completeSignIn } = await load();
      startedSignIn('expected');
      visit('/?code=abc');
      await expect(completeSignIn()).resolves.toMatchObject({ ok: false });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a reply when no sign-in was started here (missing verifier)', async () => {
      const { completeSignIn } = await load();
      visit('/?code=abc&state=s1');
      expect(await completeSignIn()).toEqual({
        ok: false,
        error: 'Spotify sign-in expired or has an invalid state. Start again from Settings.'
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['not json', '{"state":"s1"}', '{"state":"s1","verifier":""}', 'null'])(
      'treats a stale or damaged verifier (%s) as missing',
      async stored => {
        const { completeSignIn } = await load();
        sessionStorage.setItem('maxmix.pkce', stored);
        visit('/?code=abc&state=s1');
        await expect(completeSignIn()).resolves.toMatchObject({ ok: false });
        expect(fetchMock).not.toHaveBeenCalled();
      }
    );

    it('treats blocked session storage as a missing verifier', async () => {
      const { completeSignIn } = await load();
      visit('/?code=abc&state=s1');
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      await expect(completeSignIn()).resolves.toMatchObject({ ok: false });
    });

    it('uses a verifier only once', async () => {
      const { completeSignIn } = await load();
      setClientId('client-1');
      startedSignIn('s1');
      fetchMock.mockResolvedValue(json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }));
      visit('/?code=abc&state=s1');
      await completeSignIn();
      visit('/?code=abc&state=s1');
      await expect(completeSignIn()).resolves.toMatchObject({ ok: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports a declined sign-in', async () => {
      const { completeSignIn } = await load();
      startedSignIn('s1');
      visit('/?error=access_denied&state=s1');
      expect(await completeSignIn()).toEqual({ ok: false, error: 'Spotify sign-in was declined.' });
      expect(location.search).toBe('');
      expect(sessionStorage.getItem('maxmix.pkce')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports any other error code', async () => {
      const { completeSignIn } = await load();
      visit('/?error=server_error');
      expect(await completeSignIn()).toEqual({ ok: false, error: 'Spotify sign-in failed (server_error).' });
    });

    it('reports a missing code', async () => {
      const { completeSignIn } = await load();
      startedSignIn('s1');
      visit('/?state=s1&error=');
      expect(await completeSignIn()).toEqual({ ok: false, error: 'Missing Spotify authorization code.' });
    });

    it('reports a token endpoint refusal', async () => {
      const { completeSignIn, isSignedIn } = await load();
      setClientId('client-1');
      startedSignIn('s1');
      visit('/?code=abc&state=s1');
      fetchMock.mockResolvedValue(json({ error: 'invalid_grant' }, 400));
      const result = await completeSignIn();
      expect(result).toEqual({
        ok: false,
        error: 'Spotify authentication failed (400). Check the client ID and the redirect address, then sign in again.'
      });
      expect(isSignedIn()).toBe(false);
    });

    it('reports a network failure', async () => {
      const { completeSignIn } = await load();
      setClientId('client-1');
      startedSignIn('s1');
      visit('/?code=abc&state=s1');
      fetchMock.mockRejectedValue(new TypeError('offline'));
      expect(await completeSignIn()).toEqual({
        ok: false,
        error: 'Could not reach Spotify. Check the network connection.'
      });
    });

    it.each([
      ['no access token', { refresh_token: 'r', expires_in: 3600 }],
      ['no lifetime', { access_token: 'a', refresh_token: 'r' }],
      ['a non-numeric lifetime', { access_token: 'a', refresh_token: 'r', expires_in: 'soon' }]
    ])('rejects a token response with %s', async (_name, body) => {
      const { completeSignIn } = await load();
      setClientId('client-1');
      startedSignIn('s1');
      visit('/?code=abc&state=s1');
      fetchMock.mockResolvedValue(json(body));
      expect(await completeSignIn()).toEqual({ ok: false, error: 'Spotify returned an invalid token response.' });
    });

    it('rejects an unreadable token response', async () => {
      const { completeSignIn } = await load();
      setClientId('client-1');
      startedSignIn('s1');
      visit('/?code=abc&state=s1');
      fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }));
      await expect(completeSignIn()).resolves.toMatchObject({ ok: false });
    });

    it('needs a refresh token in the response', async () => {
      const { completeSignIn, isSignedIn } = await load();
      setClientId('client-1');
      startedSignIn('s1');
      visit('/?code=abc&state=s1');
      fetchMock.mockResolvedValue(json({ access_token: 'a', expires_in: 3600 }));
      expect(await completeSignIn()).toEqual({
        ok: false,
        error: 'Spotify did not provide a refresh token. Sign in again.'
      });
      expect(isSignedIn()).toBe(false);
    });

    it('shares the result when called twice at once (a StrictMode double effect)', async () => {
      const { completeSignIn } = await load();
      setClientId('client-1');
      startedSignIn('s1');
      visit('/?code=abc&state=s1');
      fetchMock.mockResolvedValue(json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }));
      const [first, second] = await Promise.all([completeSignIn(), completeSignIn()]);
      expect(first).toEqual({ ok: true });
      expect(second).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('stored login', () => {
    it('is signed out with nothing stored', async () => {
      const { isSignedIn, getAccessToken } = await load();
      expect(isSignedIn()).toBe(false);
      expect(await getAccessToken()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('ignores a login made for a different client ID', async () => {
      const { isSignedIn, getAccessToken } = await load();
      localStorage.setItem('maxmix.auth', JSON.stringify({ clientId: 'other', refreshToken: 'r' }));
      setClientId('client-1');
      expect(isSignedIn()).toBe(false);
      expect(await getAccessToken()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      // It is left in place, so switching back to that client ID signs in again.
      setClientId('other');
      expect(isSignedIn()).toBe(true);
    });

    it.each(['not json', 'null', '{"clientId":"client-1"}', '{"clientId":"client-1","refreshToken":""}', '[]'])(
      'ignores a damaged login (%s)',
      async stored => {
        const { isSignedIn } = await load();
        setClientId('client-1');
        localStorage.setItem('maxmix.auth', stored);
        expect(isSignedIn()).toBe(false);
      }
    );
  });

  describe('getAccessToken', () => {
    const signedIn = () => {
      setClientId('client-1');
      localStorage.setItem('maxmix.auth', JSON.stringify({ clientId: 'client-1', refreshToken: 'refresh-1' }));
    };

    it('refreshes with the stored refresh token and no client secret', async () => {
      const auth = await load();
      signedIn();
      fetchMock.mockResolvedValue(json({ access_token: 'access-1', expires_in: 3600 }));

      expect(await auth.getAccessToken()).toBe('access-1');

      expect(requestOf(fetchMock)[0]).toBe(TOKEN_URL);
      expect(Object.fromEntries(formOf(fetchMock))).toEqual({
        client_id: 'client-1',
        grant_type: 'refresh_token',
        refresh_token: 'refresh-1'
      });
    });

    it('keeps the old refresh token when Spotify does not send a new one', async () => {
      const auth = await load();
      signedIn();
      fetchMock.mockResolvedValue(json({ access_token: 'a', expires_in: 3600 }));
      await auth.getAccessToken();
      expect(storedLogin()).toMatchObject({ refreshToken: 'refresh-1' });
    });

    it('stores a rotated refresh token and uses it next time', async () => {
      vi.useFakeTimers();
      const auth = await load();
      signedIn();
      fetchMock
        .mockResolvedValueOnce(json({ access_token: 'a1', refresh_token: 'refresh-2', expires_in: 3600 }))
        .mockResolvedValueOnce(json({ access_token: 'a2', refresh_token: 'refresh-3', expires_in: 3600 }));
      await auth.getAccessToken();
      expect(storedLogin()).toEqual({
        clientId: 'client-1',
        refreshToken: 'refresh-2'
      });
      vi.advanceTimersByTime(3600 * 1000);
      expect(await auth.getAccessToken()).toBe('a2');
      expect(formOf(fetchMock, 1).get('refresh_token')).toBe('refresh-2');
    });

    it('caches the token until one minute before it expires', async () => {
      vi.useFakeTimers();
      const auth = await load();
      signedIn();
      fetchMock
        .mockResolvedValueOnce(json({ access_token: 'a1', expires_in: 3600 }))
        .mockResolvedValueOnce(json({ access_token: 'a2', expires_in: 3600 }));
      expect(await auth.getAccessToken()).toBe('a1');
      vi.advanceTimersByTime(3500 * 1000);
      expect(await auth.getAccessToken()).toBe('a1');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(60 * 1000);
      expect(await auth.getAccessToken()).toBe('a2');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('shares one refresh between concurrent callers', async () => {
      const auth = await load();
      signedIn();
      fetchMock.mockResolvedValue(json({ access_token: 'a1', expires_in: 3600 }));
      const tokens = await Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()]);
      expect(tokens).toEqual(['a1', 'a1', 'a1']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('can refresh again after a refresh failed', async () => {
      const auth = await load();
      signedIn();
      fetchMock
        .mockResolvedValueOnce(json({}, 500))
        .mockResolvedValueOnce(json({ access_token: 'a1', expires_in: 3600 }));
      await expect(auth.getAccessToken()).rejects.toThrow('Spotify authentication failed (500)');
      expect(auth.isSignedIn()).toBe(true);
      expect(await auth.getAccessToken()).toBe('a1');
    });

    it('forgets the login and returns an error when Spotify says it was revoked', async () => {
      const auth = await load();
      signedIn();
      fetchMock.mockResolvedValue(json({ error: 'invalid_grant' }, 400));
      await expect(auth.getAccessToken()).rejects.toMatchObject({
        status: 401,
        message: 'Spotify login expired or was revoked. Sign in again in Settings.'
      });
      expect(storedLogin()).toBeNull();
      expect(auth.isSignedIn()).toBe(false);
      expect(await auth.getAccessToken()).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the login for a 400 that is not invalid_grant', async () => {
      const auth = await load();
      signedIn();
      fetchMock.mockResolvedValue(json({ error: 'invalid_client' }, 400));
      await expect(auth.getAccessToken()).rejects.toMatchObject({ status: 502 });
      expect(auth.isSignedIn()).toBe(true);
    });

    it('keeps the login for a 400 with an unreadable body', async () => {
      const auth = await load();
      signedIn();
      fetchMock.mockResolvedValue(new Response('oops', { status: 400 }));
      await expect(auth.getAccessToken()).rejects.toMatchObject({ status: 502 });
      expect(auth.isSignedIn()).toBe(true);
    });

    it('does not keep a refresh that finished after signing out', async () => {
      const auth = await load();
      signedIn();
      const answer = json({ access_token: 'late', refresh_token: 'late-refresh', expires_in: 3600 });
      // The person signs out while Spotify is still answering.
      const slowFetch = (() => {
        auth.signOut();
        return Promise.resolve(answer);
      }) as typeof fetch;
      vi.stubGlobal('fetch', slowFetch);
      expect(await auth.getAccessToken()).toBeNull();
      expect(storedLogin()).toBeNull();
      expect(await auth.getAccessToken()).toBeNull();
    });

    it('refreshes again after discardAccessToken', async () => {
      const auth = await load();
      signedIn();
      fetchMock
        .mockResolvedValueOnce(json({ access_token: 'a1', expires_in: 3600 }))
        .mockResolvedValueOnce(json({ access_token: 'a2', expires_in: 3600 }));
      await auth.getAccessToken();
      auth.discardAccessToken();
      expect(await auth.getAccessToken()).toBe('a2');
    });

    it('does not reuse a cached token after the client ID changes', async () => {
      const auth = await load();
      signedIn();
      fetchMock.mockResolvedValue(json({ access_token: 'a1', expires_in: 3600 }));
      await auth.getAccessToken();
      setClientId('client-2');
      expect(await auth.getAccessToken()).toBeNull();
    });
  });

  describe('signOut', () => {
    it('forgets the login and the cached token', async () => {
      const auth = await load();
      setClientId('client-1');
      localStorage.setItem('maxmix.auth', JSON.stringify({ clientId: 'client-1', refreshToken: 'r' }));
      fetchMock.mockResolvedValue(json({ access_token: 'a1', expires_in: 3600 }));
      await auth.getAccessToken();
      auth.signOut();
      expect(storedLogin()).toBeNull();
      expect(auth.isSignedIn()).toBe(false);
      expect(await auth.getAccessToken()).toBeNull();
    });

    it('also forgets a sign-in that was started and never finished', async () => {
      const { signOut } = await load();
      sessionStorage.setItem('maxmix.pkce', JSON.stringify({ state: 's', verifier: 'v' }));
      signOut();
      expect(sessionStorage.getItem('maxmix.pkce')).toBeNull();
    });

    it('makes the next sign-in show Spotify’s approval page again, so nothing signs in silently', async () => {
      const { signOut, startSignIn } = await load();
      setClientId('client-1');
      signOut();
      await startSignIn();
      const url = new URL(String(app.leaveFor.mock.calls[0]?.[0]));
      expect(url.searchParams.get('show_dialog')).toBe('true');
      // And again, until a sign-in has gone through.
      await startSignIn();
      expect(new URL(String(app.leaveFor.mock.calls[1]?.[0])).searchParams.get('show_dialog')).toBe('true');
    });

    it('asks for the approval page only until a sign-in goes through', async () => {
      const { signOut, completeSignIn } = await load();
      setClientId('client-1');
      signOut();
      expect(localStorage.getItem('maxmix.freshSignIn')).toBe('true');
      sessionStorage.setItem('maxmix.pkce', JSON.stringify({ state: 's1', verifier: 'v' }));
      visit('/?code=abc&state=s1');
      fetchMock.mockResolvedValue(json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }));
      expect(await completeSignIn()).toEqual({ ok: true });
      expect(localStorage.getItem('maxmix.freshSignIn')).toBeNull();
    });

    it('keeps asking after a sign-in that was declined', async () => {
      const { signOut, completeSignIn } = await load();
      setClientId('client-1');
      signOut();
      sessionStorage.setItem('maxmix.pkce', JSON.stringify({ state: 's1', verifier: 'v' }));
      visit('/?error=access_denied&state=s1');
      expect(await completeSignIn()).toMatchObject({ ok: false });
      expect(localStorage.getItem('maxmix.freshSignIn')).toBe('true');
    });

    it('still asks when browser storage cannot hold the choice', async () => {
      const { signOut, startSignIn } = await load();
      setClientId('client-1');
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(key => {
        if (key === 'maxmix.pkce') return;
        throw new Error('blocked');
      });
      signOut();
      await startSignIn();
      expect(new URL(String(app.leaveFor.mock.calls[0]?.[0])).searchParams.get('show_dialog')).toBe('true');
    });
  });

  describe('storage unavailable', () => {
    it('keeps the login in memory until the page reloads', async () => {
      const { completeSignIn, isSignedIn, getAccessToken, signOut } = await load();
      setClientId('client-1');
      sessionStorage.setItem('maxmix.pkce', JSON.stringify({ state: 's1', verifier: 'v' }));
      visit('/?code=abc&state=s1');
      fetchMock.mockResolvedValue(json({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600 }));
      const getItem = vi.spyOn(Storage.prototype, 'getItem');
      const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      getItem.mockImplementation(key => {
        if (key === 'maxmix.people') throw new Error('blocked');
        return key === 'maxmix.pkce' ? JSON.stringify({ state: 's1', verifier: 'v' }) : null;
      });

      await expect(completeSignIn()).resolves.toMatchObject({ ok: true });
      expect(isSignedIn()).toBe(true);
      expect(await getAccessToken()).toBe('a1');

      removeItem.mockImplementation(() => {
        throw new Error('blocked');
      });
      signOut();
      expect(isSignedIn()).toBe(false);
    });
  });

  describe('people', () => {
    const signIn = async (state: string, refreshToken: string) => {
      const { completeSignIn } = await load();
      sessionStorage.setItem('maxmix.pkce', JSON.stringify({ state, verifier: 'v' }));
      visit(`/?code=c&state=${state}`);
      fetchMock.mockResolvedValueOnce(json({ access_token: 'a', refresh_token: refreshToken, expires_in: 3600 }));
      return completeSignIn();
    };
    const people = () => storedJson('maxmix.people');

    it('names a new sign-in from GET /me and makes it the active person', async () => {
      setClientId('client-1');
      await expect(signIn('s1', 'r1')).resolves.toEqual({ ok: true });
      expect(people()).toEqual({
        clientId: 'client-1',
        activeId: 'nikolai',
        people: [{ spotifyId: 'nikolai', name: 'Nikolai', imageUrl: 'https://i.scdn.co/image/n', refreshToken: 'r1' }]
      });
    });

    it('keeps everyone else when someone signs in, and replaces the token of someone signing in again', async () => {
      setClientId('client-1');
      localStorage.setItem(
        'maxmix.people',
        JSON.stringify({
          clientId: 'client-1',
          activeId: 'friend',
          people: [
            { spotifyId: 'friend', name: 'Friend', imageUrl: '', refreshToken: 'rf' },
            { spotifyId: 'nikolai', name: 'Nikolai', imageUrl: '', refreshToken: 'old' },
            { spotifyId: 'broken' }
          ]
        })
      );
      await signIn('s1', 'new');
      expect(people()).toMatchObject({
        activeId: 'nikolai',
        people: [
          { spotifyId: 'friend', refreshToken: 'rf' },
          { spotifyId: 'nikolai', refreshToken: 'new' }
        ]
      });
    });

    it('names someone with no display name or picture by their Spotify ID', async () => {
      setClientId('client-1');
      vi.stubGlobal('fetch', (url: string, init: RequestInit) =>
        url === 'https://api.spotify.com/v1/me'
          ? Promise.resolve(json({ id: 'quiet' }))
          : (fetchMock(url, init) as Promise<Response>)
      );
      await signIn('s1', 'r1');
      expect(people()).toMatchObject({ people: [{ spotifyId: 'quiet', name: 'quiet', imageUrl: '' }] });
    });

    it('signs in unnamed when GET /me cannot be reached', async () => {
      setClientId('client-1');
      vi.stubGlobal('fetch', (url: string, init: RequestInit) =>
        url === 'https://api.spotify.com/v1/me'
          ? Promise.reject(new TypeError('Failed to fetch'))
          : (fetchMock(url, init) as Promise<Response>)
      );
      await signIn('s1', 'r1');
      expect(people()).toMatchObject({ activeId: '', people: [{ spotifyId: '', refreshToken: 'r1' }] });
    });

    it('signs in unnamed when GET /me fails', async () => {
      setClientId('client-1');
      vi.stubGlobal('fetch', (url: string, init: RequestInit) =>
        url === 'https://api.spotify.com/v1/me'
          ? Promise.resolve(new Response('busy', { status: 503 }))
          : (fetchMock(url, init) as Promise<Response>)
      );
      await signIn('s1', 'r1');
      expect(people()).toMatchObject({ activeId: '', people: [{ spotifyId: '', name: '', refreshToken: 'r1' }] });
    });

    it('moves the login kept before there were people into the list, and names it once a token works', async () => {
      setClientId('client-1');
      localStorage.setItem('maxmix.auth', JSON.stringify({ clientId: 'client-1', refreshToken: 'r1' }));
      const auth = await load();
      expect(auth.isSignedIn()).toBe(true);
      expect(localStorage.getItem('maxmix.auth')).toBeNull();
      expect(people()).toEqual({
        clientId: 'client-1',
        activeId: '',
        people: [{ spotifyId: '', name: '', imageUrl: '', refreshToken: 'r1' }]
      });
      fetchMock.mockResolvedValueOnce(json({ access_token: 'a1', refresh_token: 'r2', expires_in: 3600 }));
      expect(await auth.getAccessToken()).toBe('a1');
      await vi.waitFor(() => expect(people()).toMatchObject({ activeId: 'nikolai' }));
      expect(people()).toEqual({
        clientId: 'client-1',
        activeId: 'nikolai',
        people: [{ spotifyId: 'nikolai', name: 'Nikolai', imageUrl: 'https://i.scdn.co/image/n', refreshToken: 'r2' }]
      });
      expect(auth.isSignedIn()).toBe(true);
    });

    it('keeps a rotated token for the active person only', async () => {
      setClientId('client-1');
      localStorage.setItem(
        'maxmix.people',
        JSON.stringify({
          clientId: 'client-1',
          activeId: '',
          people: [
            { spotifyId: 'friend', name: 'Friend', imageUrl: '', refreshToken: 'rf' },
            { spotifyId: '', name: '', imageUrl: '', refreshToken: 'r1' }
          ]
        })
      );
      const auth = await load();
      fetchMock.mockResolvedValueOnce(json({ access_token: 'a1', refresh_token: 'r2', expires_in: 3600 }));
      await auth.getAccessToken();
      await vi.waitFor(() => expect(people()).toMatchObject({ activeId: 'nikolai' }));
      expect(people()).toMatchObject({
        activeId: 'nikolai',
        people: [
          { spotifyId: 'friend', refreshToken: 'rf' },
          { spotifyId: 'nikolai', refreshToken: 'r2' }
        ]
      });
    });

    it('forgets only the active person when Spotify says their login was revoked', async () => {
      setClientId('client-1');
      localStorage.setItem(
        'maxmix.people',
        JSON.stringify({
          clientId: 'client-1',
          activeId: 'nikolai',
          people: [
            { spotifyId: 'friend', name: 'Friend', imageUrl: '', refreshToken: 'rf' },
            { spotifyId: 'nikolai', name: 'Nikolai', imageUrl: '', refreshToken: 'rn' }
          ]
        })
      );
      const auth = await load();
      fetchMock.mockResolvedValueOnce(json({ error: 'invalid_grant' }, 400));
      await expect(auth.getAccessToken()).rejects.toMatchObject({ status: 401 });
      expect(people()).toMatchObject({ activeId: null, people: [{ spotifyId: 'friend' }] });
      expect(auth.isSignedIn()).toBe(false);
    });

    it('reads a list it cannot make sense of as nobody', async () => {
      setClientId('client-1');
      localStorage.setItem('maxmix.people', JSON.stringify({ clientId: 'client-1', people: 'x' }));
      const first = await load();
      expect(first.isSignedIn()).toBe(false);
      localStorage.setItem('maxmix.people', '{');
      const second = await load();
      expect(second.isSignedIn()).toBe(false);
    });
  });
});
