# Security policy

## Supported versions

Only the latest [release](https://github.com/nvorkinn/the-max-mix/releases/latest) receives security fixes.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub:
[Security > Report a vulnerability](https://github.com/nvorkinn/the-max-mix/security/advisories/new).

Useful details: what you found, the version or commit, steps to reproduce, and the impact (for example exposure of a
Spotify refresh token). You can expect an initial reply within a few days.

## Threat model

THE MAX MIX is a client-only app: static files that run in one browser, the kiosk. There is no backend and no
server-side secret.

- **No client secret.** Sign-in uses the Authorization Code flow with PKCE, which Spotify provides for apps that cannot
  keep a secret. The Spotify client ID is public by design and may be baked into a release or container image.
- **The refresh token lives in the browser.** It is stored in the browser's `localStorage` (key `maxmix.auth`) and the
  page calls the Spotify Web API directly. Anyone who can use the kiosk's browser profile, or read its files, has the
  Spotify login. Treat the device and its profile like the account: restrict physical access, keep SSH key-protected and
  keep the OS and browser updated. Signing out in Settings removes the token, and you can revoke the app under your
  Spotify account's apps. Access tokens are short-lived and kept in memory only.
- **Cross-site scripting matters more.** Script running in the page's origin can read `localStorage`. The app renders
  Spotify's text as plain text and ships no user-supplied HTML, but keep the origin dedicated: do not host other apps
  on the same host and port, and keep dependencies up to date. The static server sets `X-Content-Type-Options` and
  `Referrer-Policy` but no Content-Security-Policy, because the Spotify Web Playback SDK loads from several hosts.
- **Not applicable any more.** With no server there is no server-side token file, no `Host` header check, no DNS
  rebinding or cross-site request forgery exposure against a local API, and no proxy trust to configure.
- **The static server serves public files only.** `scripts/serve.mjs` listens on loopback by default. Putting it on a
  public address needs HTTPS (Spotify requires it). Anyone who opens the page can sign in with their own Spotify
  account, but a shared browser profile is a shared login.
