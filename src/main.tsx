import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { kioskScreen, needsRegistration } from './countdown/registration';
import type { KioskScreen } from './countdown/registration';
import { startSoloistPerson } from './countdown/soloist';
import { captureBrowserErrors } from './utils/debugLog';
import { installHttpLog } from './utils/httpLog';
import { startHandover, takeHandover } from './utils/handover';
import { isKiosk, piVersion } from './utils/kiosk';
import { startKioskWatch } from './utils/kioskWatch';
import './index.css';

// Copies console errors and uncaught errors into the hidden debug console from the start.
captureBrowserErrors();
installHttpLog();

// Remembers ?kiosk=1 and the Pi version before anything can navigate away (registration returns without the query).
piVersion();
if (isKiosk()) {
  document.documentElement.classList.add('hide-cursor');
  // The Pi restarts the kiosk shell when these heartbeats stop, and keeps the app's errors in its journal.
  startKioskWatch();
  // The hosted app hands its saved data to the Pi, for the copy the Pi serves itself (utils/handover.ts).
  startHandover();
  // The Pi runs Spotify Soloist for whoever is active, with their own key from countdown-server (countdown/soloist.ts).
  startSoloistPerson();
}

/** Starts the app. */
function startApp(pairScreen: KioskScreen | null = null): void {
  const root = document.querySelector('#root');
  if (!root) throw new Error('Missing #root element');
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App pairScreen={pairScreen} />
    </React.StrictMode>
  );
}

// The copy the Pi serves takes the hosted app's saved data first, so it starts signed in and registered as before.
void (isKiosk() ? takeHandover() : Promise.resolve()).then(() => {
  if (needsRegistration()) {
    // A kiosk with no device ID shows a QR code to add it to countdown-server over the app, until someone has (the
    // sign-in is on their phone, so none waits on the kiosk). When the Pi cannot say what its screen is, the app starts
    // unregistered, and the next start tries again.
    void kioskScreen().then(screen => {
      if (!screen) console.warn('The kiosk did not say what its screen is, so it is not registered yet');
      startApp(screen);
    });
  } else {
    startApp();
  }
});
