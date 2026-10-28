export async function requestJSON(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(data.error || `Request failed (${response.status}).`), {
      status: response.status,
      retryAfter: Number(response.headers.get('Retry-After')) || 0
    });
  }
  return data;
}

export function postJSON(url, body = {}) {
  return requestJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}
