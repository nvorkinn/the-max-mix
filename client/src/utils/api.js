/**
 * The response shape is not checked at runtime; callers name it with a `@type` cast on the awaited result.
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<unknown>}
 */
export async function requestJSON(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  /** @type {unknown} */
  const body = await response.json();
  const data = /** @type {{ error?: string }} */ (body);
  if (!response.ok) {
    throw Object.assign(new Error(data.error || `Request failed (${response.status}).`), {
      status: response.status,
      retryAfter: Number(response.headers.get('Retry-After')) || 0
    });
  }
  return data;
}

/**
 * @param {string} url
 * @param {object} [body]
 */
export function postJSON(url, body = {}) {
  return requestJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}
