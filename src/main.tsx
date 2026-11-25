import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { needsSetup } from './countdown/registration';
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
  // The Pi restarts Chromium when these heartbeats stop, and keeps the app's errors in its journal.
  startKioskWatch();
  // The hosted app hands its saved data to the Pi, for the copy the Pi serves itself (utils/handover.ts).
  startHandover();
  // The Pi runs Spotify Soloist for whoever is active, with their own key from countdown-server (countdown/soloist.ts).
  startSoloistPerson();
}

/** Starts the app, or the first-time setup wizard on a kiosk that hasn't been through it. */
function startApp(): void {
  const root = document.querySelector('#root');
  if (!root) throw new Error('Missing #root element');
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App isSettingUp={needsSetup()} />
    </React.StrictMode>
  );
}

// The copy the Pi serves takes the hosted app's saved data first, so it starts signed in and registered as before.
void (isKiosk() ? takeHandover() : Promise.resolve()).then(startApp);
