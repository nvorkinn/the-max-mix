import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { completeSignIn } from './spotify/auth';
import './index.css';

// Finishes a sign-in first (Spotify sends the browser back with ?code=), so the app starts with the auth state final.
const signedIn = completeSignIn().catch((error: unknown) => ({
  ok: false as const,
  error: (error as Error).message
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
