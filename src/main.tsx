import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { completeSignIn } from './spotify/auth';
import { captureBrowserErrors } from './utils/debugLog';
import { errorMessage } from './utils/errorMessage';
import { hidesCursor, isKiosk } from './utils/kiosk';
import './index.css';

// Copies console errors and uncaught errors into the hidden debug console from the start.
captureBrowserErrors();

// Remembers ?kiosk=1 and ?cursor=hidden before anything can navigate away (the sign-in redirect returns without the query).
isKiosk();
if (hidesCursor()) document.documentElement.classList.add('hide-cursor');

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
