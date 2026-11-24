import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import { forgetSoloistKey, newSoloistKeyCode, soloistKeyPeople } from './soloistKeys';

const SECRET = fixture.registration.secret;
const CLIENT = { baseUrl: 'https://countdown.build', secret: SECRET };
const SITE = 'https://app.countdown.build';
const PERSON = fixture.soloist_code_request.person;

function answer(status: number, body?: unknown) {
  const fetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function unreachable() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
  );
}

/**
 * The request a fetch was called with, whole but for its signal: the test environment's AbortSignal is jsdom's, which
 * Node's Request doesn't take.
 */
function requestOf(fetch: ReturnType<typeof answer>): Request {
  const [input, init] = fetch.mock.calls[0] ?? [''];
  return new Request(input, { ...init, signal: null });
}

const signal = () => new AbortController().signal;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-24T12:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('soloistKeyPeople', () => {
  it('lists the people with a key, with the device secret', async () => {
    const fetch = answer(200, fixture.soloist_keys);
    await expect(soloistKeyPeople(CLIENT, signal())).resolves.toEqual([PERSON]);
    const request = requestOf(fetch);
    expect(request.url).toBe('https://countdown.build/api/devices/soloist/keys');
    expect(request.method).toBe('GET');
    expect(request.headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
  });

  it('says so while nobody owns the kiosk, and cannot tell when the server refuses or cannot be reached', async () => {
    answer(409, { error: "the device isn't paired yet" });
    await expect(soloistKeyPeople(CLIENT, signal())).resolves.toBe('unpaired');
    answer(401);
    await expect(soloistKeyPeople(CLIENT, signal())).resolves.toBeNull();
    unreachable();
    await expect(soloistKeyPeople(CLIENT, signal())).resolves.toBeNull();
  });
});

describe('newSoloistKeyCode', () => {
  it("asks for a code for the person, as the settings site's page, lasting as long as the server says", async () => {
    const fetch = answer(201, fixture.soloist_code);
    await expect(newSoloistKeyCode(CLIENT, SITE, PERSON, signal())).resolves.toEqual({
      pageUrl: `${SITE}/soloist?code=${fixture.soloist_page.code}`,
      expiresAt: Date.now() + fixture.soloist_code.expires_in * 1000
    });
    const request = requestOf(fetch);
    expect(request.url).toBe('https://countdown.build/api/devices/soloist/codes');
    expect(request.method).toBe('POST');
    expect(request.headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
    await expect(request.json()).resolves.toEqual(fixture.soloist_code_request);
  });

  it('says so while nobody owns the kiosk, and cannot tell when the server refuses or cannot be reached', async () => {
    answer(409, { error: "the device isn't paired yet" });
    await expect(newSoloistKeyCode(CLIENT, SITE, PERSON, signal())).resolves.toBe('unpaired');
    answer(400, { error: 'bad person' });
    await expect(newSoloistKeyCode(CLIENT, SITE, PERSON, signal())).resolves.toBeNull();
    unreachable();
    await expect(newSoloistKeyCode(CLIENT, SITE, PERSON, signal())).resolves.toBeNull();
  });
});

describe('forgetSoloistKey', () => {
  it("asks the server to forget the person's key, and asks nothing with no server", () => {
    const fetch = answer(204);
    forgetSoloistKey(PERSON, null);
    expect(fetch).not.toHaveBeenCalled();
    forgetSoloistKey(PERSON, CLIENT);
    expect(fetch).toHaveBeenCalledOnce();
    const request = requestOf(fetch);
    expect(request.url).toBe(`https://countdown.build/api/devices/soloist/keys/${PERSON}`);
    expect(request.method).toBe('DELETE');
    expect(request.headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
  });
});
