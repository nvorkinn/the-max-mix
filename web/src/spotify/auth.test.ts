import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { parseJson } from './http';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';

const app = vi.hoisted(() => ({ clientId: '' }));

// The real client ID is a constant; tests switch it to check that a login belongs to one client ID.
vi.mock('./settings', async importOriginal => ({
  ...(await importOriginal<typeof import('./settings')>()),
  getClientId: () => app.clientId
}));

// Where countdown-server says Spotify sent the phone back to.
const REDIRECT = 'https://app.countdown.build/spotify/sign-in/callback';
/** Spotify's reply to a sign-in on a phone, with its code. */
const reply = (code = 'abc') => ({ code, redirectUri: REDIRECT });

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
    fetchMock = vi.fn();
    // GET /me names the account; fetchMock sees the token endpoint only.
    vi.stubGlobal('fetch', (url: string, init: RequestInit) =>
      url === 'https://api.spotify.com/v1/me' ? Promise.resolve(json(ME)) : (fetchMock(url, init) as Promise<Response>)
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('newVerifier', () => {
    it('makes a verifier and its S256 challenge', async () => {
      const { newVerifier } = await load();

      const { verifier, challenge } = await newVerifier();

      expect(verifier).toMatch(/^[\w-]{43,128}$/);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      const expected = btoa(String.fromCodePoint(...new Uint8Array(digest)))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
      expect(challenge).toBe(expected);
    });

    it('makes a new verifier every time', async () => {
      const { newVerifier } = await load();
      const first = await newVerifier();
      const second = await newVerifier();
      expect(second.verifier).not.toBe(first.verifier);
    });
  });

  describe('finishSignIn', () => {
    it('exchanges the code with the kiosk’s verifier and the phone’s redirect address, and stores the login', async () => {
      const { finishSignIn, isSignedIn, getAccessToken } = await load();
      setClientId('client-1');
      fetchMock.mockResolvedValue(json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }));

      expect(await finishSignIn(reply(), 'the-verifier')).toEqual({ ok: true });

      expect(requestOf(fetchMock)[0]).toBe(TOKEN_URL);
      const init = requestOf(fetchMock)[1];
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
      expect(Object.fromEntries(formOf(fetchMock))).toEqual({
        client_id: 'client-1',
        grant_type: 'authorization_code',
        code: 'abc',
        redirect_uri: REDIRECT,
        code_verifier: 'the-verifier'
      });
      expect(storedLogin()).toEqual({
        clientId: 'client-1',
        refreshToken: 'refresh-1'
      });
      expect(isSignedIn()).toBe(true);
      // The access token from the exchange is reused rather than refreshed at once.
      expect(await getAccessToken()).toBe('access-1');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports a declined sign-in', async () => {
      const { finishSignIn } = await load();
      expect(await finishSignIn({ error: 'access_denied', redirectUri: REDIRECT }, 'v')).toEqual({
        ok: false,
        error: 'Spotify sign-in was declined.'
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports any other error code', async () => {
      const { finishSignIn } = await load();
      expect(await finishSignIn({ error: 'server_error', redirectUri: REDIRECT }, 'v')).toEqual({
        ok: false,
        error: 'Spotify sign-in failed (server_error).'
      });
    });

    it('reports a missing code', async () => {
      const { finishSignIn } = await load();
      expect(await finishSignIn({ redirectUri: REDIRECT }, 'v')).toEqual({
        ok: false,
        error: 'Missing Spotify authorization code.'
      });
    });

    it('reports a token endpoint refusal', async () => {
      const { finishSignIn, isSignedIn } = await load();
      setClientId('client-1');
      fetchMock.mockResolvedValue(json({ error: 'invalid_grant' }, 400));
      expect(await finishSignIn(reply(), 'v')).toEqual({
        ok: false,
        error: 'Spotify authentication failed (400). Check the client ID and the redirect address, then sign in again.'
      });
      expect(isSignedIn()).toBe(false);
    });

    it('reports a network failure', async () => {
      const { finishSignIn } = await load();
      setClientId('client-1');
      fetchMock.mockRejectedValue(new TypeError('offline'));
      expect(await finishSignIn(reply(), 'v')).toEqual({
        ok: false,
        error: 'Could not reach Spotify. Check the network connection.'
      });
    });

    it.each([
      ['no access token', { refresh_token: 'r', expires_in: 3600 }],
      ['no lifetime', { access_token: 'a', refresh_token: 'r' }],
      ['a non-numeric lifetime', { access_token: 'a', refresh_token: 'r', expires_in: 'soon' }]
    ])('rejects a token response with %s', async (_name, body) => {
      const { finishSignIn } = await load();
      setClientId('client-1');
      fetchMock.mockResolvedValue(json(body));
      expect(await finishSignIn(reply(), 'v')).toEqual({
        ok: false,
        error: 'Spotify returned an invalid token response.'
      });
    });

    it('rejects an unreadable token response', async () => {
      const { finishSignIn } = await load();
      setClientId('client-1');
      fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }));
      await expect(finishSignIn(reply(), 'v')).resolves.toMatchObject({ ok: false });
    });

    it('needs a refresh token in the response', async () => {
      const { finishSignIn, isSignedIn } = await load();
      setClientId('client-1');
      fetchMock.mockResolvedValue(json({ access_token: 'a', expires_in: 3600 }));
      expect(await finishSignIn(reply(), 'v')).toEqual({
        ok: false,
        error: 'Spotify did not provide a refresh token. Sign in again.'
      });
      expect(isSignedIn()).toBe(false);
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
      expect(storedLogin()?.refreshToken ?? '').toBe('');
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
  });

  describe('storage unavailable', () => {
    it('keeps the login in memory until the page reloads', async () => {
      const { finishSignIn, isSignedIn, getAccessToken, signOut } = await load();
      setClientId('client-1');
      fetchMock.mockResolvedValue(json({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600 }));
      const getItem = vi.spyOn(Storage.prototype, 'getItem');
      const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      getItem.mockImplementation(key => {
        if (key === 'maxmix.people') throw new Error('blocked');
        return null;
      });

      await expect(finishSignIn(reply(), 'v')).resolves.toMatchObject({ ok: true });
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
    const signIn = async (code: string, refreshToken: string) => {
      const { finishSignIn } = await load();
      fetchMock.mockResolvedValueOnce(json({ access_token: 'a', refresh_token: refreshToken, expires_in: 3600 }));
      return finishSignIn(reply(code), 'v');
    };
    const people = () => storedJson('maxmix.people');

    it('offers to pair a phone once after someone signs in without one', async () => {
      setClientId('client-1');
      await expect(signIn('s1', 'r1')).resolves.toEqual({ ok: true });
      const { takePhoneToPair, linkPhone } = await import('./auth');
      expect(takePhoneToPair()).toBe('nikolai');
      expect(takePhoneToPair()).toBeNull();
      linkPhone('nikolai', 'AA:01');
      await expect(signIn('s2', 'r2')).resolves.toEqual({ ok: true });
      const again = await import('./auth');
      expect(again.takePhoneToPair()).toBeNull();
    });

    it('names a new sign-in from GET /me and makes it the active person', async () => {
      setClientId('client-1');
      await expect(signIn('s1', 'r1')).resolves.toEqual({ ok: true });
      expect(people()).toEqual({
        clientId: 'client-1',
        activeId: 'nikolai',
        people: [
          {
            spotifyId: 'nikolai',
            name: 'Nikolai',
            imageUrl: 'https://i.scdn.co/image/n',
            refreshToken: 'r1',
            phoneAddress: ''
          }
        ]
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
        people: [{ spotifyId: '', name: '', imageUrl: '', refreshToken: 'r1', phoneAddress: '' }]
      });
      fetchMock.mockResolvedValueOnce(json({ access_token: 'a1', refresh_token: 'r2', expires_in: 3600 }));
      expect(await auth.getAccessToken()).toBe('a1');
      await vi.waitFor(() => expect(people()).toMatchObject({ activeId: 'nikolai' }));
      expect(people()).toEqual({
        clientId: 'client-1',
        activeId: 'nikolai',
        people: [
          {
            spotifyId: 'nikolai',
            name: 'Nikolai',
            imageUrl: 'https://i.scdn.co/image/n',
            refreshToken: 'r2',
            phoneAddress: ''
          }
        ]
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

    it('keeps the active person, signed out, when Spotify says their login was revoked', async () => {
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
      expect(people()).toMatchObject({
        activeId: 'nikolai',
        people: [
          { spotifyId: 'friend', refreshToken: 'rf' },
          { spotifyId: 'nikolai', refreshToken: '' }
        ]
      });
      expect(auth.isSignedIn()).toBe(false);
      expect(auth.peopleOnKiosk().map(person => person.signedIn)).toEqual([true, false]);
      // Read back after a reload, they are still listed.
      const reloaded = await load();
      expect(reloaded.peopleOnKiosk().map(person => person.spotifyId)).toEqual(['friend', 'nikolai']);
      expect(await reloaded.getAccessToken()).toBeNull();
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

  describe('adding and removing people', () => {
    const person = (spotifyId: string) => ({
      spotifyId,
      name: spotifyId,
      imageUrl: '',
      refreshToken: `r-${spotifyId}`
    });
    const store = (activeId: string | null, ids: string[]) =>
      localStorage.setItem(
        'maxmix.people',
        JSON.stringify({ clientId: 'client-1', activeId, people: ids.map(id => person(id)) })
      );
    const signIn = async (code: string) => {
      const auth = await load();
      fetchMock.mockResolvedValueOnce(json({ access_token: 'a', refresh_token: 'r-new', expires_in: 3600 }));
      return { auth, result: await auth.finishSignIn(reply(code), 'v') };
    };
    const people = () => storedJson('maxmix.people');

    it('lists the people under the client ID in use, without their tokens', async () => {
      setClientId('client-1');
      store('b', ['a', 'b']);
      const auth = await load();
      expect(auth.peopleOnKiosk()).toEqual([
        { spotifyId: 'a', name: 'a', imageUrl: '', phoneAddress: '', active: false, signedIn: true },
        { spotifyId: 'b', name: 'b', imageUrl: '', phoneAddress: '', active: true, signedIn: true }
      ]);
      setClientId('client-2');
      expect(auth.peopleOnKiosk()).toEqual([]);
    });

    it('refuses a sixth person', async () => {
      setClientId('client-1');
      store('a', ['a', 'b', 'c', 'd', 'e']);

      const { result } = await signIn('s1');
      expect(result).toEqual({ ok: false, error: 'Spotify allows five people on this kiosk. Remove someone first.' });
      expect(people()).toMatchObject({ activeId: 'a' });
      expect(people()?.['people']).toHaveLength(5);
    });

    it('lets someone already listed sign in again when there are five', async () => {
      setClientId('client-1');
      store('a', ['a', 'b', 'c', 'd', 'nikolai']);
      const { result } = await signIn('s1');
      expect(result).toEqual({ ok: true });
      expect(people()).toMatchObject({ activeId: 'nikolai' });
    });

    it('refuses an account Spotify answers with 403 and keeps the active person', async () => {
      setClientId('client-1');
      store('a', ['a']);
      vi.stubGlobal('fetch', (url: string, init: RequestInit) =>
        url === 'https://api.spotify.com/v1/me'
          ? Promise.resolve(new Response('User not registered in the Developer Dashboard', { status: 403 }))
          : (fetchMock(url, init) as Promise<Response>)
      );
      const { result } = await signIn('s1');
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('User Management') as unknown });
      expect(people()).toMatchObject({ activeId: 'a', people: [{ spotifyId: 'a' }] });
    });

    it('removes someone who is not active and keeps playing as the active person', async () => {
      setClientId('client-1');
      store('a', ['a', 'b']);
      localStorage.setItem('maxmix.knownSpeakers', JSON.stringify({ a: [{ id: 'x' }], b: [{ id: 'y' }] }));
      const auth = await load();
      expect(auth.removePerson('b')).toBe('kept');
      expect(people()).toMatchObject({ activeId: 'a', people: [{ spotifyId: 'a' }] });
      expect(storedJson('maxmix.knownSpeakers')).toEqual({ a: [{ id: 'x' }] });
    });

    it('makes the next person active when the active person is removed', async () => {
      setClientId('client-1');
      store('a', ['a', 'b']);
      const auth = await load();
      expect(auth.removePerson('a')).toBe('switched');
      expect(people()).toMatchObject({ activeId: 'b', people: [{ spotifyId: 'b' }] });
      expect(auth.isSignedIn()).toBe(true);
    });

    it('signs out when the last person is removed', async () => {
      setClientId('client-1');
      store('a', ['a']);
      const auth = await load();
      expect(auth.removePerson('a')).toBe('signed-out');
      expect(people()).toBeNull();
      expect(auth.isSignedIn()).toBe(false);
    });
  });

  describe('switching person', () => {
    const twoPeople = {
      clientId: 'client-1',
      activeId: 'nikolai',
      people: [
        { spotifyId: 'nikolai', name: 'Nikolai', imageUrl: 'n.jpg', refreshToken: 'rn', phoneAddress: 'AA:BB' },
        { spotifyId: 'friend', name: 'Friend', imageUrl: '', refreshToken: 'rf' }
      ]
    };

    it('lists each person’s linked phone, reading a missing one as none', async () => {
      setClientId('client-1');
      localStorage.setItem('maxmix.people', JSON.stringify(twoPeople));
      const { peopleOnKiosk } = await load();
      expect(peopleOnKiosk().map(person => person.phoneAddress)).toEqual(['AA:BB', '']);
    });

    it('makes another person active, and refreshes with their token next', async () => {
      setClientId('client-1');
      localStorage.setItem('maxmix.people', JSON.stringify(twoPeople));
      const { switchPerson, getAccessToken } = await load();
      fetchMock.mockResolvedValueOnce(json({ access_token: 'an', expires_in: 3600 }));
      await expect(getAccessToken()).resolves.toBe('an');
      switchPerson('friend');
      expect(storedLogin()).toEqual({ clientId: 'client-1', refreshToken: 'rf' });
      fetchMock.mockResolvedValueOnce(json({ access_token: 'af', expires_in: 3600 }));
      await expect(getAccessToken()).resolves.toBe('af');
      expect(formOf(fetchMock, 1).get('refresh_token')).toBe('rf');
      switchPerson('nobody');
      expect(storedLogin()).toEqual({ clientId: 'client-1', refreshToken: 'rf' });
    });

    it('gives a token for someone who is not active without changing who is', async () => {
      setClientId('client-1');
      localStorage.setItem('maxmix.people', JSON.stringify(twoPeople));
      const { getAccessTokenFor } = await load();
      fetchMock.mockResolvedValueOnce(json({ access_token: 'af', refresh_token: 'rf2', expires_in: 3600 }));
      await expect(getAccessTokenFor('friend')).resolves.toBe('af');
      expect(formOf(fetchMock).get('refresh_token')).toBe('rf');
      await expect(getAccessTokenFor('friend')).resolves.toBe('af');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(storedLogin()).toEqual({ clientId: 'client-1', refreshToken: 'rn' });
      expect(JSON.stringify(storedJson('maxmix.people'))).toContain('rf2');
      fetchMock.mockResolvedValueOnce(json({ access_token: 'an', expires_in: 3600 }));
      await expect(getAccessTokenFor('nikolai')).resolves.toBe('an');
      await expect(getAccessTokenFor('nobody')).resolves.toBeNull();
      setClientId('client-2');
      await expect(getAccessTokenFor('friend')).resolves.toBeNull();
    });

    it('marks only someone else signed out when Spotify says their login was revoked', async () => {
      setClientId('client-1');
      localStorage.setItem('maxmix.people', JSON.stringify(twoPeople));
      const { getAccessTokenFor, isSignedIn, peopleOnKiosk } = await load();
      fetchMock.mockResolvedValueOnce(json({ error: 'invalid_grant' }, 400));
      await expect(getAccessTokenFor('friend')).rejects.toMatchObject({ status: 401 });
      expect(isSignedIn()).toBe(true);
      expect(peopleOnKiosk().map(person => [person.spotifyId, person.signedIn])).toEqual([
        ['nikolai', true],
        ['friend', false]
      ]);
      await expect(getAccessTokenFor('friend')).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps someone else’s login when Spotify refuses their token for another reason', async () => {
      setClientId('client-1');
      localStorage.setItem('maxmix.people', JSON.stringify(twoPeople));
      const { getAccessTokenFor, peopleOnKiosk } = await load();
      fetchMock.mockResolvedValueOnce(json({ error: 'invalid_client' }, 400));
      await expect(getAccessTokenFor('friend')).rejects.toThrow('Spotify authentication failed (400)');
      expect(peopleOnKiosk().every(person => person.signedIn)).toBe(true);
    });

    describe('checkPerson', () => {
      const stubMe = (status: number) =>
        vi.stubGlobal('fetch', (url: string, init: RequestInit) =>
          url === 'https://api.spotify.com/v1/me'
            ? Promise.resolve(json(ME, status))
            : (fetchMock(url, init) as Promise<Response>)
        );

      it.each([
        [200, 'connected'],
        [403, 'refused'],
        [500, 'unknown']
      ])('reads GET /me answering %i as %s', async (status, expected) => {
        setClientId('client-1');
        localStorage.setItem('maxmix.people', JSON.stringify(twoPeople));
        stubMe(status);
        const { checkPerson } = await load();
        fetchMock.mockResolvedValueOnce(json({ access_token: 'af', expires_in: 3600 }));
        await expect(checkPerson('friend')).resolves.toBe(expected);
      });

      it('says expired when Spotify revokes the login, and without asking again once it has', async () => {
        setClientId('client-1');
        localStorage.setItem('maxmix.people', JSON.stringify(twoPeople));
        const { checkPerson } = await load();
        fetchMock.mockResolvedValueOnce(json({ error: 'invalid_grant' }, 400));
        await expect(checkPerson('nikolai')).resolves.toBe('expired');
        await expect(checkPerson('nikolai')).resolves.toBe('expired');
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      it('says unknown when Spotify cannot be reached', async () => {
        setClientId('client-1');
        localStorage.setItem('maxmix.people', JSON.stringify(twoPeople));
        const { checkPerson } = await load();
        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await expect(checkPerson('friend')).resolves.toBe('unknown');
      });
    });

    describe('signing someone in again', () => {
      const signInAgain = async (as: string, activeId = 'nikolai') => {
        setClientId('client-1');
        localStorage.setItem(
          'maxmix.people',
          JSON.stringify({
            ...twoPeople,
            activeId,
            people: twoPeople.people.map(person => ({ ...person, refreshToken: '' }))
          })
        );
        const auth = await load();
        fetchMock.mockResolvedValueOnce(json({ access_token: 'a', refresh_token: 'r-new', expires_in: 3600 }));
        return { auth, result: await auth.finishSignIn(reply('c'), 'v', as) };
      };

      it('signs the same account in again, keeping their phone', async () => {
        const { auth, result } = await signInAgain('nikolai');
        expect(result).toEqual({ ok: true });
        expect(auth.peopleOnKiosk()).toMatchObject([
          { spotifyId: 'nikolai', phoneAddress: 'AA:BB', active: true, signedIn: true },
          { spotifyId: 'friend', signedIn: false }
        ]);
      });

      it('refuses a different account and changes nothing', async () => {
        // GET /me answers as Nikolai, so signing Friend in again gets the wrong account.
        const { auth, result } = await signInAgain('friend');
        expect(result).toEqual({ ok: false, error: 'That was a different Spotify account, so nothing changed.' });
        expect(auth.peopleOnKiosk().map(person => person.signedIn)).toEqual([false, false]);
      });

      it('leaves someone else active when they are still signed in', async () => {
        setClientId('client-1');
        localStorage.setItem(
          'maxmix.people',
          JSON.stringify({
            ...twoPeople,
            activeId: 'friend',
            people: [{ ...twoPeople.people[0], refreshToken: '' }, twoPeople.people[1]]
          })
        );
        const auth = await load();
        fetchMock.mockResolvedValueOnce(json({ access_token: 'a', refresh_token: 'r-new', expires_in: 3600 }));
        expect(await auth.finishSignIn(reply('c'), 'v', 'nikolai')).toEqual({ ok: true });
        expect(auth.peopleOnKiosk()).toMatchObject([
          { spotifyId: 'nikolai', active: false, signedIn: true },
          { spotifyId: 'friend', active: true }
        ]);
        // Their fresh token is kept for them, not handed to the active person.
        await expect(auth.getAccessTokenFor('nikolai')).resolves.toBe('a');
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
    });

    it('links and unlinks a phone', async () => {
      setClientId('client-1');
      localStorage.setItem('maxmix.people', JSON.stringify(twoPeople));
      const { linkPhone, peopleOnKiosk } = await load();
      linkPhone('friend', 'CC:DD');
      linkPhone('nikolai', '');
      expect(peopleOnKiosk().map(person => person.phoneAddress)).toEqual(['', 'CC:DD']);
    });
  });
});
