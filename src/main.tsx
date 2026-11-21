import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { completeRegistration, needsRegistration, startRegistration } from './countdown/registration';
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

// Coming back from countdown-server's /register page keeps the device ID it gave; that address's `error` is the
// server's, so it is read (and taken out of the address) before the Spotify sign-in looks for one of its own.
const registration = completeRegistration();
const registrationError = registration && !registration.ok ? registration.error : null;

/** Starts the app, once a Spotify sign-in it came back from (Spotify sends the browser back to / with ?code=) is done. */
function startApp(): void {
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
        <App signInError={signInError} registrationError={registrationError} />
      </React.StrictMode>
    );
  });
}

if (!registration && needsRegistration()) {
  // A kiosk with no device ID adds itself to countdown-server before anything else; the server sends it back here. When
  // the Pi cannot say what its screen is, the app starts unregistered, and the next start tries again.
  void startRegistration().then(hasLeft => {
    if (!hasLeft) startApp();
  });
} else {
  startApp();
}
