// The extension's service worker. Signing out of the app forgets only the app's own Spotify tokens; Spotify's sign-in
// stays in Chromium as cookies on accounts.spotify.com, so the next "Log in with Spotify" would go straight to the
// approval page as the same person. On the app's request (sign-out.ts) this clears the cookies and storage of every
// site but the app itself: Spotify, and Google, Apple or Facebook when one of those signed in to Spotify.
interface BrowsingData {
  remove: (options: { excludeOrigins: string[] }, dataTypes: Record<string, boolean>) => Promise<void>;
}
interface Sender {
  origin?: string;
}
declare const chrome: {
  browsingData: BrowsingData;
  runtime: {
    onMessage: {
      addListener: (
        listener: (message: unknown, sender: Sender, respond: (answer: unknown) => void) => boolean | undefined
      ) => void;
    };
  };
};

const FORGET = 'maxmix:forget-sign-ins';

// The app keeps its settings (client ID, colours, speakers) in its own storage, so its origin is left alone.
export const DATA_TYPES = {
  cacheStorage: true,
  cookies: true,
  fileSystems: true,
  indexedDB: true,
  localStorage: true,
  serviceWorkers: true
};

/** Clears every site's data but `appOrigin`'s. */
export async function forgetSignIns(browsingData: BrowsingData, appOrigin: string): Promise<void> {
  await browsingData.remove({ excludeOrigins: [appOrigin] }, DATA_TYPES);
}

if (typeof chrome !== 'undefined') {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    const isForget = typeof message === 'object' && message !== null && 'type' in message && message.type === FORGET;
    // Only sign-out.ts sends this, and it runs on the app's pages alone, so the sender is the app.
    if (!isForget || !sender.origin) return undefined;
    forgetSignIns(chrome.browsingData, sender.origin).then(
      () => respond({ ok: true }),
      () => respond({ ok: false })
    );
    return true;
  });
}
