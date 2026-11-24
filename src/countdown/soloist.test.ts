import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import * as auth from '../spotify/auth';
import type { PersonOnKiosk } from '../spotify/auth';
import { KIOSK_SERVICE } from '../utils/kioskService';
import * as registration from './registration';
import { tellSoloistPerson } from './soloist';

const SECRET = fixture.registration.secret;
const PERSON = fixture.soloist_key_query.person;

const someone: PersonOnKiosk = {
  spotifyId: PERSON,
  name: 'Someone',
  imageUrl: '',
  phoneAddress: '',
  active: true,
  signedIn: true
};

function register() {
  vi.spyOn(registration, 'deviceCredentials').mockReturnValue({ deviceId: fixture.device_id, secret: SECRET });
}

function signIn(people: PersonOnKiosk[] = [someone]) {
  vi.spyOn(auth, 'peopleOnKiosk').mockReturnValue(people);
  vi.spyOn(auth, 'getActivePersonId').mockReturnValue(people.find(person => person.active)?.spotifyId ?? null);
}

/** The kiosk's service answers with `status` and `body`. */
function answer(status = 200, body: unknown = { state: 'playing' }) {
  const fetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status }))
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const requests = (fetch: ReturnType<typeof answer>) =>
  fetch.mock.calls.map(([input, init]) => new Request(input, init));

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_COUNTDOWN_API', 'https://countdown.build');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('tellSoloistPerson', () => {
  it("tells the kiosk's service who is active, with the server and the device secret", async () => {
    register();
    signIn();
    const fetch = answer();

    await expect(tellSoloistPerson()).resolves.toBe('playing');

    const [request] = requests(fetch);
    expect(request?.url).toBe(`${KIOSK_SERVICE}/soloist/person`);
    expect(request?.method).toBe('POST');
    expect(await request?.json()).toEqual({ person: PERSON, server: 'https://countdown.build', secret: SECRET });
  });

  it('says nothing before the kiosk is registered', async () => {
    signIn();
    const fetch = answer();
    await expect(tellSoloistPerson()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops Soloist when nobody is signed in', async () => {
    register();
    signIn([]);
    const fetch = answer(204);
    await expect(tellSoloistPerson()).resolves.toBe('stopped');
    expect(requests(fetch).map(request => request.url)).toEqual([`${KIOSK_SERVICE}/soloist/stop`]);
  });

  it("is null when the kiosk's service does not answer", async () => {
    register();
    signIn();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(tellSoloistPerson()).resolves.toBeNull();
  });

  it('passes on why Soloist is not playing', async () => {
    register();
    signIn();
    answer(200, { state: 'no-key' });
    await expect(tellSoloistPerson()).resolves.toBe('no-key');
  });
});
