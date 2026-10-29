# Security policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub:
[Security > Report a vulnerability](https://github.com/nvorkinn/the-max-mix/security/advisories/new).

Useful details: what you found, the commit or the date you saw it, steps to reproduce, and the impact (for example exposure of a
Spotify refresh token). You can expect an initial reply within a few days.

## Threat model

THE MAX MIX is a client-only app: static files that run in the browser. The kiosk serves a prebuilt release from the Pi itself, on
`127.0.0.1` only. There is no backend of ours and no server-side secret.

- **No client secret.** Sign-in uses the Authorization Code flow with PKCE, which Spotify provides for apps that cannot
  keep a secret. The Spotify client ID is public by design and is a constant in the code (`src/spotify/settings.ts`).
- **The refresh token lives in the browser.** It is stored in the browser's `localStorage` (key `maxmix.auth`) and the
  page calls the Spotify Web API directly. Anyone who can use the kiosk's browser profile, or read its files, has the
  Spotify login. Treat the device and its profile like the account: restrict physical access, keep SSH key-protected and
  keep the OS and browser updated. Signing out in Settings removes the token, and you can revoke the app under your
  Spotify account's apps. Access tokens are short-lived and kept in memory only.
- **Cross-site scripting matters more.** Script running in the page's origin can read `localStorage`. The app renders
  Spotify's text as plain text and ships no user-supplied HTML, but keep the origin dedicated: do not host other apps
  on the same origin, and keep dependencies up to date. The kiosk's server sends no security headers and the app sets
  no Content-Security-Policy, because the Spotify Web Playback SDK loads from several hosts.
- **The kiosk's local server.** It serves static files from the unpacked release with Python's built-in web server,
  bound to `127.0.0.1` so nothing else on the network can reach it, and it has no API, no token file and no write access.
  Other users or programs on the Pi itself can reach the port, so treat the Pi as single-user. The installer verifies
  the release's SHA-256, which is published next to it on the same deployment, so it catches a damaged download but
  not a compromised deployment: the security of a release is the security of the repository's tags, the `VERCEL_TOKEN`
  secret and the Vercel account. Protect them with two-factor authentication.
- **The app is public static code.** Anyone who runs it can sign in with their own Spotify account, and each browser
  keeps its own login; a shared browser profile is a shared login. Only addresses registered as redirect URIs in the
  Spotify dashboard can sign in.
