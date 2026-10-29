import { createPublicKey, verify } from 'node:crypto';

const KEYS_TTL_MS = 60 * 60 * 1000;
const KEYS_MIN_REFRESH_MS = 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;
const FETCH_TIMEOUT_MS = 5000;

/**
 * @typedef {import('node:crypto').webcrypto.JsonWebKey & { kid?: string }} PublishedKey
 * @typedef {{ alg?: string, kid?: string, iss?: string, aud?: string | string[], exp?: number, nbf?: number }} Claims
 */

/** A refusal with the HTTP status to answer it with. */
export class AccessError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   */
  constructor(message, status) {
    super(message);
    this.name = 'AccessError';
    this.status = status;
  }
}

// JSON.parse() and Response.json() return any; what they parse is untrusted until checked, so type it as unknown.
/**
 * @param {string} text
 * @returns {unknown}
 */
const parseJson = text => JSON.parse(text);
/**
 * @param {Response} response
 * @returns {Promise<unknown>}
 */
const readJson = response => response.json();

/**
 * @param {string} url
 * @returns {Promise<unknown>}
 */
async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return readJson(response);
}

/** @param {string} part */
function decodeJson(part) {
  return /** @type {Claims} */ (parseJson(Buffer.from(part, 'base64url').toString('utf8')));
}

/**
 * The RSA keys in a JWKS document (https://<team>/cdn-cgi/access/certs), by key id.
 * @param {unknown} body
 */
function rsaKeys(body) {
  const published = body && typeof body === 'object' && 'keys' in body ? body.keys : undefined;
  const list = /** @type {PublishedKey[]} */ (Array.isArray(published) ? published : []);
  /** @type {Map<string, import('node:crypto').KeyObject>} */
  const keys = new Map();
  for (const { kid, ...jwk } of list) {
    if (kid && jwk.kty === 'RSA') keys.set(kid, createPublicKey({ key: jwk, format: 'jwk' }));
  }
  return keys;
}

/**
 * Checks the token Cloudflare Access adds to each request it lets through (the Cf-Access-Jwt-Assertion header): an
 * RS256 signature by one of the team's published keys, the team as issuer, this application's audience tag and a
 * current expiry. Anyone who can reach the server without going through Cloudflare has no such token.
 * @param {{
 *   teamDomain: string,
 *   audience: string,
 *   fetchKeys?: (url: string) => Promise<unknown>,
 *   now?: () => number
 * }} options
 */
export function createAccessVerifier({ teamDomain, audience, fetchKeys = fetchJson, now = Date.now }) {
  const issuer = `https://${teamDomain}`;
  /** @type {{ keys: Map<string, import('node:crypto').KeyObject>, fetchedAt: number } | null} */
  let cache = null;

  async function refreshKeys() {
    /** @type {unknown} */
    let body;
    try {
      body = await fetchKeys(`${issuer}/cdn-cgi/access/certs`);
    } catch {
      throw new AccessError('Could not load Cloudflare Access signing keys. Try again shortly.', 503);
    }
    cache = { keys: rsaKeys(body), fetchedAt: now() };
  }

  /** @param {string} kid */
  async function keyFor(kid) {
    const age = cache ? now() - cache.fetchedAt : Infinity;
    // Stale keys are replaced; an unknown key id (a rotation) fetches again too, but not on every bad token.
    if (age >= KEYS_TTL_MS || (!cache?.keys.has(kid) && age >= KEYS_MIN_REFRESH_MS)) await refreshKeys();
    return cache?.keys.get(kid);
  }

  /** @param {string} [token] */
  return async function verifyToken(token = '') {
    const parts = token.split('.', 4);
    if (parts.length !== 3) throw new AccessError('Missing Cloudflare Access token.', 401);
    const [encodedHeader = '', encodedPayload = '', signature = ''] = parts;
    /** @type {Claims} */
    let header;
    /** @type {Claims} */
    let payload;
    try {
      header = decodeJson(encodedHeader);
      payload = decodeJson(encodedPayload);
    } catch {
      throw new AccessError('Malformed Cloudflare Access token.', 403);
    }
    // Only RS256, as Access signs: never the algorithm the token itself names, which is how "none" gets in.
    if (header.alg !== 'RS256' || !header.kid) throw new AccessError('Unsupported Cloudflare Access token.', 403);
    const key = await keyFor(header.kid);
    const signed = Buffer.from(`${encodedHeader}.${encodedPayload}`);
    if (!key || !verify('sha256', signed, key, Buffer.from(signature, 'base64url'))) {
      throw new AccessError('Cloudflare Access token rejected.', 403);
    }
    const seconds = now() / 1000;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const current =
      typeof payload.exp === 'number' &&
      payload.exp > seconds - CLOCK_SKEW_SECONDS &&
      (payload.nbf === undefined || payload.nbf <= seconds + CLOCK_SKEW_SECONDS);
    if (payload.iss !== issuer || !audiences.includes(audience) || !current) {
      throw new AccessError('Cloudflare Access token rejected.', 403);
    }
    return payload;
  };
}

/**
 * Lets a request through only with a valid Access token, once Access is required. Required but not configured (a
 * public address, no team domain or audience yet) refuses everything, so the app is never open by default. The health
 * check is left open for the container's own probe; Cloudflare keeps it from outside.
 * @param {{
 *   access: { required: boolean, configured: boolean },
 *   verifyToken?: ((token?: string) => Promise<unknown>) | undefined
 * }} options
 * @returns {import('express').RequestHandler}
 */
export function accessGuard({ access, verifyToken }) {
  return async (req, res, next) => {
    if (!access.required || req.path === '/api/health') return next();
    if (!access.configured || !verifyToken) {
      return res.status(503).json({ error: 'Cloudflare Access is not configured on this server yet.' });
    }
    try {
      await verifyToken(req.get('Cf-Access-Jwt-Assertion'));
      return next();
    } catch (error) {
      if (error instanceof AccessError) return res.status(error.status).json({ error: error.message });
      throw error;
    }
  };
}
