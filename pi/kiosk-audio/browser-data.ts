// Clears what other sites keep in the kiosk's Chromium when someone signs out (the app's POST /browser/forget-sign-ins).
// Signing out of the app forgets only the app's own Spotify tokens; Spotify's sign-in stays in Chromium as cookies on
// accounts.spotify.com, so the next "Log in with Spotify" would go straight to the approval page as the same person. A
// page cannot clear another site's data, so this service does it over DevTools, which the kiosk's Chromium serves on
// 127.0.0.1 only (kiosk-session): every cookie goes, with the storage of each site that had one (Spotify, and Google,
// Apple or Facebook when one of those signed in to Spotify). The app keeps its settings in its own storage on this
// service's origin, which has no cookies, so it is left alone.

/** Where the kiosk's Chromium serves DevTools (kiosk-session's devtools_port). */
const DEVTOOLS = 'http://127.0.0.1:9222';
const TIMEOUT_MS = 10_000;
const STORAGE_TYPES = 'cookies,local_storage,indexeddb,cache_storage,service_workers,file_systems';
const OWN_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** Sends one DevTools command and resolves to its result. */
export type Send = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/** The sites that set the cookies, as origins, leaving out the kiosk's own. */
export function cookieOrigins(cookies: { domain: string }[]): string[] {
  const hosts = new Set(cookies.map(cookie => cookie.domain.replace(/^\./, '')));
  return [...hosts]
    .filter(host => host !== '' && !OWN_HOSTS.has(host))
    .map(host => `https://${host}`)
    .sort();
}

/** Clears each cookie site's storage, then every cookie. */
export async function forgetSites(send: Send): Promise<void> {
  const { cookies = [] } = (await send('Storage.getCookies')) as { cookies?: { domain: string }[] };
  for (const origin of cookieOrigins(cookies)) {
    await send('Storage.clearDataForOrigin', { origin, storageTypes: STORAGE_TYPES });
  }
  await send('Storage.clearCookies');
}

/** A connection to the browser's DevTools at `base`: its commands, and a way to close it. */
async function connect(base: string): Promise<{ send: Send; close: () => void }> {
  const response = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const { webSocketDebuggerUrl } = (await response.json()) as { webSocketDebuggerUrl?: string };
  if (webSocketDebuggerUrl === undefined) throw new Error('Chromium gave no DevTools address');
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not reach Chromium over DevTools')), { once: true });
  });
  const waiting = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();
  socket.addEventListener('message', (event: MessageEvent<string>) => {
    const answer = JSON.parse(event.data) as { id?: number; result?: unknown; error?: { message: string } };
    if (answer.id === undefined) return;
    const call = waiting.get(answer.id);
    if (call === undefined) return;
    waiting.delete(answer.id);
    if (answer.error) call.reject(new Error(answer.error.message));
    else call.resolve(answer.result);
  });
  let lastId = 0;
  const send: Send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      lastId += 1;
      const id = lastId;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`DevTools did not answer ${method}`));
      }, TIMEOUT_MS);
      waiting.set(id, {
        resolve: result => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        }
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  return { send, close: () => socket.close() };
}

/** Clears every other site's sign-in from the kiosk's Chromium. Rejects when DevTools could not be reached. */
export async function forgetSignIns(base = DEVTOOLS): Promise<void> {
  const devtools = await connect(base);
  try {
    await forgetSites(devtools.send);
  } finally {
    devtools.close();
  }
}
