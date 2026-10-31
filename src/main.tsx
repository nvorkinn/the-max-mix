import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { completeSignIn } from './spotify/auth';
import { errorMessage } from './utils/errorMessage';
import { hidesCursor, isKiosk, piVersion } from './utils/kiosk';
import './index.css';

// Remembers ?kiosk=1, ?cursor=hidden and the Pi version before anything can navigate away (the sign-in redirect returns without the query).
isKiosk();
piVersion();
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
