// Optional logging of every HTTP call the page makes, for the debug console: each request, and its response or failure.
// Off by default, and switched in the console. It wraps `fetch` once at start-up and looks at the setting on every call.
// Sensitive values never reach the log: the headers that carry credentials and the query values that look like them are
// replaced. Only the response headers the browser lets the page read are shown (CORS hides the rest). Storage can be
// unavailable: every access tolerates that.

import { debugLog } from './debugLog';
import { errorMessage } from './errorMessage';

const HTTP_LOG_KEY = 'maxmix.httpLog';

/** off: nothing. calls: one line per request and per response. headers: those lines with their headers as well. */
export type HttpLogMode = 'off' | 'calls' | 'headers';

export function getHttpLogMode(): HttpLogMode {
  try {
    const stored = localStorage.getItem(HTTP_LOG_KEY);
    return stored === 'calls' || stored === 'headers' ? stored : 'off';
  } catch {
    return 'off';
  }
}

export function setHttpLogMode(mode: HttpLogMode): void {
  try {
    if (mode === 'off') localStorage.removeItem(HTTP_LOG_KEY);
    else localStorage.setItem(HTTP_LOG_KEY, mode);
  } catch {
    // Storage is unavailable; the setting then lasts only until the page reloads.
  }
}

const SECRET_HEADER = /^(authorization|cookie|set-cookie|proxy-authorization|client-token|content-access-token)$/i;
const SECRET_QUERY = /token|code|secret|verifier|state|key/i;
const REDACTED = '[redacted]';

function describeUrl(raw: string): string {
  try {
    const url = new URL(raw, location.href);
    const names = new Set(url.searchParams.keys());
    for (const name of names) {
      if (SECRET_QUERY.test(name)) url.searchParams.set(name, REDACTED);
    }
    return url.href;
  } catch {
    return raw;
  }
}

function describeHeaders(headers: Headers): string {
  const lines = [...headers].map(([name, value]) => `  ${name}: ${SECRET_HEADER.test(name) ? REDACTED : value}`);
  return lines.length > 0 ? `\n${lines.join('\n')}` : ' (none readable)';
}

/** Wraps `window.fetch` so that calls are logged while the setting is on. Safe to call more than once. */
let installed = false;
export function installHttpLog(): void {
  if (installed) return;
  installed = true;
  const original = window.fetch.bind(window);
  // eslint-disable-next-line unicorn/no-global-object-property-assignment -- Wrapping fetch is the point of this module.
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const mode = getHttpLogMode();
    if (mode === 'off') return original(input, init);
    const request = input instanceof Request ? input : undefined;
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    let target: string;
    if (typeof input === 'string') target = input;
    else if (input instanceof URL) target = input.href;
    else target = input.url;
    const label = `${method} ${describeUrl(target)}`;
    const showHeaders = mode === 'headers';
    const sent = showHeaders
      ? `\nRequest headers:${describeHeaders(new Headers(init?.headers ?? request?.headers))}`
      : '';
    debugLog('info', 'http', `→ ${label}${sent}`);
    const started = performance.now();
    try {
      const response = await original(input, init);
      const took = Math.round(performance.now() - started);
      const received = showHeaders ? `\nResponse headers:${describeHeaders(response.headers)}` : '';
      debugLog(response.ok ? 'info' : 'warn', 'http', `← ${response.status} ${label} (${took} ms)${received}`);
      return response;
    } catch (error) {
      const took = Math.round(performance.now() - started);
      debugLog('error', 'http', `✕ ${label} failed after ${took} ms: ${errorMessage(error)}`);
      throw error;
    }
  };
}
