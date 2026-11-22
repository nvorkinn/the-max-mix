// Clears what other sites keep in the kiosk's Chromium when someone signs out (the app's POST /browser/forget-sign-ins).
// Signing out of the app forgets only the app's own Spotify tokens; Spotify's sign-in stays in Chromium as cookies on
// accounts.spotify.com, so the next "Log in with Spotify" would go straight to the approval page as the same person. A
// page cannot clear another site's data, so this service does it over DevTools, which the kiosk's Chromium serves on
// 127.0.0.1 only (kiosk-session): every cookie goes, which is what holds the sign-ins, and then, as far as Chromium allows,
// the storage of each site that had one (Spotify, and Google, Apple or Facebook when one of those signed in to Spotify).
// Chromium refuses Storage.clearDataForOrigin on the browser's own DevTools connection (Internal error, Chromium 156), so
// that goes through the app's page instead, and a site it cannot clear does not keep the cookies. The app keeps its
// settings in its own storage on this service's origin, which has no cookies, so it is left alone.

/** Where the kiosk's Chromium serves DevTools (kiosk-session's devtools_port). */
const DEVTOOLS = 'http://127.0.0.1:9222';
const TIMEOUT_MS = 10_000;
const STORAGE_TYPES = 'cookies,local_storage,indexeddb,cache_storage,service_workers,file_systems';
const OWN_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** Sends one DevTools command, to the browser or to the target attached as `sessionId`, and resolves to its result. */
export type Send = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<unknown>;

/** What a clear did: the cookies it deleted, and how many of the sites they came from had their storage cleared. */
export interface Forgotten {
  cookies: number;
  sites: number;
  sitesCleared: number;
}

/** The sites that set the cookies, as origins, leaving out the kiosk's own. */
export function cookieOrigins(cookies: { domain: string }[]): string[] {
  const hosts = new Set(cookies.map(cookie => cookie.domain.replace(/^\./, '')));
  return [...hosts]
    .filter(host => host !== '' && !OWN_HOSTS.has(host))
    .map(host => `https://${host}`)
    .toSorted((a, b) => a.localeCompare(b));
}

/** A DevTools session on one of the browser's pages, or undefined when there is none it could attach to. */
async function pageSession(send: Send): Promise<string | undefined> {
  let session: string | undefined;
  try {
    const { targetInfos = [] } = (await send('Target.getTargets')) as {
      targetInfos?: { targetId: string; type: string }[];
    };
    const page = targetInfos.find(target => target.type === 'page');
    if (page) {
      const { sessionId } = (await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })) as {
        sessionId?: string;
      };
      session = sessionId;
    }
  } catch {
    // No page to attach to: the sites' storage stays, the cookies are gone anyway.
  }
  return session;
}

/** Clears every cookie, then the storage of each site that had one, as far as Chromium lets it. */
export async function forgetSites(send: Send): Promise<Forgotten> {
  const { cookies = [] } = (await send('Storage.getCookies')) as { cookies?: { domain: string }[] };
  await send('Storage.clearCookies');
  const origins = cookieOrigins(cookies);
  let sitesCleared = 0;
  if (origins.length > 0) {
    const session = await pageSession(send);
    if (session !== undefined) {
      const results = await Promise.allSettled(
        origins.map(origin => send('Storage.clearDataForOrigin', { origin, storageTypes: STORAGE_TYPES }, session))
      );
      sitesCleared = results.filter(result => result.status === 'fulfilled').length;
      try {
        await send('Target.detachFromTarget', { sessionId: session });
      } catch {
        // The page went away (a reload): its session went with it.
      }
    }
  }
  return { cookies: cookies.length, sites: origins.length, sitesCleared };
}

/** A connection to the browser's DevTools at `base`: its commands, and a way to close it. */
async function connect(base: string): Promise<{ send: Send; close: () => void }> {
  const response = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const { webSocketDebuggerUrl } = (await response.json()) as { webSocketDebuggerUrl?: string };
  if (webSocketDebuggerUrl === undefined) throw new Error('Chromium gave no DevTools address');
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener(
      'open',
      () => {
        resolve();
      },
      { once: true }
    );
    socket.addEventListener(
      'error',
      () => {
        reject(new Error('Could not reach Chromium over DevTools'));
      },
      { once: true }
    );
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
  const send: Send = (method, params = {}, sessionId) =>
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
      socket.send(JSON.stringify(sessionId === undefined ? { id, method, params } : { id, method, params, sessionId }));
    });
  return {
    send,
    close: () => {
      socket.close();
    }
  };
}

/**
 * Clears every other site's sign-in from the kiosk's Chromium, and logs what it cleared or why it could not. Rejects when
 * DevTools could not be reached or refused to delete the cookies.
 */
export async function forgetSignIns(base = DEVTOOLS): Promise<void> {
  try {
    const devtools = await connect(base);
    try {
      const { cookies, sites, sitesCleared } = await forgetSites(devtools.send);
      console.log(`Forgot the other sites' sign-ins: ${cookies} cookies, storage of ${sitesCleared} of ${sites} sites`);
    } finally {
      devtools.close();
    }
  } catch (error) {
    console.error("Could not forget the other sites' sign-ins:", error);
    throw error;
  }
}
