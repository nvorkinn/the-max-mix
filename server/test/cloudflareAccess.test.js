import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { AccessError, accessGuard, createAccessVerifier } from '../src/cloudflareAccess.js';

const TEAM = 'team.cloudflareaccess.com';
const AUDIENCE = 'b'.repeat(64);
const OTHER_AUDIENCE = 'c'.repeat(64);
const NOW = 1_800_000_000_000;

/** @param {string} kid */
function makeKey(kid) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid } };
}

const key = makeKey('key-1');

/** @param {unknown} value */
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * Signs a token the way Access does unless told otherwise.
 * @param {{ header?: Record<string, unknown>, payload?: Record<string, unknown>, signer?: ReturnType<typeof makeKey> }} [options]
 */
function token({ header = {}, payload = {}, signer = key } = {}) {
  const head = encode({ alg: 'RS256', kid: signer.kid, ...header });
  const body = encode({
    iss: `https://${TEAM}`,
    aud: [AUDIENCE],
    exp: NOW / 1000 + 3600,
    email: 'someone@example.com',
    ...payload
  });
  const signature = sign('sha256', Buffer.from(`${head}.${body}`), signer.privateKey).toString('base64url');
  return `${head}.${body}.${signature}`;
}

/**
 * @param {{ keys?: unknown[], fail?: boolean }} [options]
 */
function setup({ keys = [key.jwk], fail = false } = {}) {
  /** @type {string[]} */
  const fetched = [];
  let clock = NOW;
  const verify = createAccessVerifier({
    teamDomain: TEAM,
    audience: AUDIENCE,
    now: () => clock,
    fetchKeys: async url => {
      fetched.push(url);
      if (fail) throw new Error('offline');
      return { keys };
    }
  });
  return {
    verify,
    fetched,
    /** @param {number} ms */
    advance: ms => {
      clock += ms;
    }
  };
}

/**
 * @param {Promise<unknown>} promise
 * @param {number} status
 */
const refusedWith = (promise, status) =>
  assert.rejects(promise, error => error instanceof AccessError && error.status === status);

test('accepts a token signed by the team, for this application, that has not expired', async () => {
  const { verify, fetched } = setup();
  const payload = /** @type {{ email: string }} */ (await verify(token()));
  assert.equal(payload.email, 'someone@example.com');
  assert.deepEqual(fetched, [`https://${TEAM}/cdn-cgi/access/certs`]);
});

test('accepts the audience given as a plain string', async () => {
  const { verify } = setup();
  await assert.doesNotReject(verify(token({ payload: { aud: AUDIENCE } })));
});

test('refuses a missing or malformed token with 401 or 403', async () => {
  const { verify } = setup();
  await refusedWith(verify(), 401);
  await refusedWith(verify('only.two'), 401);
  await refusedWith(verify('not.json.parts'), 403);
});

test('refuses tokens for another application, team, or past their expiry, or not yet valid', async () => {
  const { verify } = setup();
  const seconds = NOW / 1000;
  for (const payload of [
    { aud: [OTHER_AUDIENCE] },
    { aud: undefined },
    { iss: 'https://other.cloudflareaccess.com' },
    { exp: seconds - 3600 },
    { exp: undefined },
    { nbf: seconds + 3600 }
  ]) {
    const rejected = token({ payload });
    await refusedWith(verify(rejected), 403);
  }
});

test('refuses a token signed by another key, or naming an algorithm other than RS256', async () => {
  const { verify } = setup();
  const stranger = makeKey('key-1');
  for (const options of [
    { signer: stranger },
    { header: { alg: 'none' } },
    { header: { alg: 'HS256' } },
    { header: { kid: undefined } }
  ]) {
    const rejected = token(options);
    await refusedWith(verify(rejected), 403);
  }
  // A tampered payload under a real signature.
  const [head = '', , signature = ''] = token().split('.', 3);
  const forged = encode({ iss: `https://${TEAM}`, aud: [AUDIENCE], exp: 9e9 });
  await refusedWith(verify([head, forged, signature].join('.')), 403);
});

test('fetches the keys once and reuses them, and fetches again when they are stale', async () => {
  const { verify, fetched, advance } = setup();
  await verify(token());
  await verify(token());
  assert.equal(fetched.length, 1);
  advance(61 * 60 * 1000);
  await verify(token({ payload: { exp: NOW / 1000 + 7200 } }));
  assert.equal(fetched.length, 2);
});

test('an unknown key id fetches again, but not on every bad token', async () => {
  const rotated = makeKey('key-2');
  /** @type {unknown[]} */
  let published = [key.jwk];
  /** @type {string[]} */
  const fetched = [];
  let clock = NOW;
  const verify = createAccessVerifier({
    teamDomain: TEAM,
    audience: AUDIENCE,
    now: () => clock,
    fetchKeys: async url => {
      fetched.push(url);
      return { keys: published };
    }
  });
  await verify(token());
  published = [key.jwk, rotated.jwk];
  // Within the minimum refresh gap the new key isn't looked for, so a flood of unknown ids can't hammer Cloudflare.
  await refusedWith(verify(token({ signer: rotated })), 403);
  assert.equal(fetched.length, 1);
  clock += 61 * 1000;
  await verify(token({ signer: rotated }));
  assert.equal(fetched.length, 2);
});

test('answers 503 when the keys cannot be loaded, and ignores keys that are not RSA', async () => {
  await refusedWith(setup({ fail: true }).verify(token()), 503);
  const { verify } = setup({ keys: [{ kty: 'EC', kid: 'key-1', crv: 'P-256', x: 'x', y: 'y' }, { kty: 'RSA' }] });
  await refusedWith(verify(token()), 403);
});

/**
 * @param {ReturnType<typeof accessGuard>} guard
 * @param {string} path
 * @param {string} [header]
 */
async function run(guard, path, header) {
  /** @type {{ status?: number, body?: unknown, next: boolean }} */
  const result = { next: false };
  /** @type {{ status: (status: number) => unknown, json: (body: unknown) => unknown }} */
  const res = {
    status: status => {
      result.status = status;
      return res;
    },
    json: body => {
      result.body = body;
      return res;
    }
  };
  const req = { path, get: () => header };
  await guard(
    /** @type {import('express').Request} */ (/** @type {unknown} */ (req)),
    /** @type {import('express').Response} */ (/** @type {unknown} */ (res)),
    () => {
      result.next = true;
    }
  );
  return result;
}

test('the guard lets everything through when Access is not required', async () => {
  const guard = accessGuard({ access: { required: false, configured: false } });
  assert.equal((await run(guard, '/api/token')).next, true);
});

test('the guard refuses everything but the health check while Access is required and not configured', async () => {
  const guard = accessGuard({ access: { required: true, configured: false } });
  assert.equal((await run(guard, '/api/health')).next, true);
  const refused = await run(guard, '/');
  assert.equal(refused.next, false);
  assert.equal(refused.status, 503);
});

test("the guard passes a verified token on and answers the verifier's refusal otherwise", async () => {
  const guard = accessGuard({
    access: { required: true, configured: true },
    verifyToken: async value => {
      if (value !== 'ok') throw new AccessError('Cloudflare Access token rejected.', 403);
      return {};
    }
  });
  assert.equal((await run(guard, '/api/token', 'ok')).next, true);
  const refused = await run(guard, '/api/token', 'nope');
  assert.deepEqual([refused.next, refused.status], [false, 403]);
});

test('the guard does not swallow an unexpected failure', async () => {
  const guard = accessGuard({
    access: { required: true, configured: true },
    verifyToken: async () => {
      throw new TypeError('bug');
    }
  });
  await assert.rejects(run(guard, '/api/token', 'x'), TypeError);
});
