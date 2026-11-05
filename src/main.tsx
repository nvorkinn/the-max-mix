import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { completeSignIn } from './spotify/auth';
import { captureBrowserErrors } from './utils/debugLog';
import { installHttpLog } from './utils/httpLog';
import { errorMessage } from './utils/errorMessage';
import { isKiosk, piVersion } from './utils/kiosk';
import { startKioskWatch } from './utils/kioskWatch';
import './index.css';

// Copies console errors and uncaught errors into the hidden debug console from the start.
captureBrowserErrors();
installHttpLog();

// Remembers ?kiosk=1 and the Pi version before anything can navigate away (the sign-in redirect returns without the query).
piVersion();
if (isKiosk()) {
  document.documentElement.classList.add('hide-cursor');
  // The Pi restarts Chromium when these heartbeats stop, and keeps the app's errors in its journal.
  startKioskWatch();
}

// Finishes a sign-in first (Spotify sends the browser back with ?code=), so the app starts with the auth state final.
const signedIn = completeSignIn().catch((error: unknown) => ({
  ok: false as const,
  error: errorMessage(error)
}));
void signedIn.then(result => {
  const signInError = result && !result.ok ? result.error : null;
  const root = document.querySelector('#root');
  if (!root) throw new Error('Missing #root element');
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App signInError={signInError} />
    </React.StrictMode>
  );
});
