# Security policy

## Supported versions

Only the latest deployed version (the `main` branch, hosted on Vercel) receives security fixes.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub:
[Security > Report a vulnerability](https://github.com/nvorkinn/the-max-mix/security/advisories/new).

Useful details: what you found, the commit or the date you saw it, steps to reproduce, and the impact (for example exposure of a
Spotify refresh token). You can expect an initial reply within a few days.

## Threat model

THE MAX MIX is a client-only app: static files hosted by Vercel that run in each visitor's browser, the kiosk
included. There is no backend of ours and no server-side secret.

- **No client secret.** Sign-in uses the Authorization Code flow with PKCE, which Spotify provides for apps that cannot
  keep a secret. The Spotify client ID is public by design and is a constant in the code (`src/spotify/settings.ts`).
- **The refresh token lives in the browser.** It is stored in the browser's `localStorage` (key `maxmix.auth`) and the
  page calls the Spotify Web API directly. Anyone who can use the kiosk's browser profile, or read its files, has the
  Spotify login. Treat the device and its profile like the account: restrict physical access, keep SSH key-protected and
  keep the OS and browser updated. Signing out in Settings removes the token, and you can revoke the app under your
  Spotify account's apps. Access tokens are short-lived and kept in memory only.
- **Cross-site scripting matters more.** Script running in the page's origin can read `localStorage`. The app renders
  Spotify's text as plain text and ships no user-supplied HTML, but keep the origin dedicated: do not host other apps
  on the same origin, and keep dependencies up to date. The site sets `X-Content-Type-Options` and
  `Referrer-Policy` (in `vercel.json`) but no Content-Security-Policy, because the Spotify Web Playback SDK loads from
  several hosts.
- **Not applicable any more.** With no server of ours there is no server-side token file, no `Host` header check, no
  DNS rebinding or cross-site request forgery exposure against a local API, and no proxy trust to configure.
- **The site is public static code.** Anyone who opens it can sign in with their own Spotify account, and each browser
  keeps its own login; a shared browser profile is a shared login. Only addresses registered as redirect URIs in the
  Spotify dashboard can sign in. The Vercel account and project settings (the production branch, the domain) are the
  deployment's trust boundary: protect them with two-factor authentication and keep the DNS record pointing at Vercel.
