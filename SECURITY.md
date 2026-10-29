# Security policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub:
[Security > Report a vulnerability](https://github.com/nvorkinn/the-max-mix/security/advisories/new).

Useful details: what you found, the commit or the date you saw it, steps to reproduce, and the impact (for example exposure of a
Spotify refresh token). You can expect an initial reply within a few days.

## Threat model

THE MAX MIX is a client-only app: static files that run in the browser. The kiosk is Chromium opening the deployed site. There is no backend of ours and no server-side secret.

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
  `Referrer-Policy` (in `vercel.json`) but no Content-Security-Policy, because the Spotify Web Playback SDK loads from several hosts.
- **The kiosk's playbook.** The Pi runs `ansible-pull` against this repository's `main` branch, as the desktop user,
  with `sudo` for packages, lingering and `raspi-config`. Whoever can push to `main` can change what runs on the Pi,
  so protect the repository and its branch rules, and pin `-C` to a reviewed tag if you want updates only on request.
  Chromium keeps its sandbox enabled.
- **The app is public static code.** Anyone who runs it can sign in with their own Spotify account, and each browser
  keeps its own login; a shared browser profile is a shared login. Only addresses registered as redirect URIs in the
  Spotify dashboard can sign in.
- **The Wi-Fi panel.** A native Qt panel (`pi/wifi-panel/`) runs as the non-root `kiosk` user and joins networks with
  `nmcli`; a polkit rule (`pi/rootfs/etc/polkit-1/rules.d/50-kiosk-networkmanager.rules`) lets only that user manage
  NetworkManager connections. The password reaches `nmcli` on stdin, never in argv, and is not logged; every call is an
  argument list with no shell, and the panel has no network listener. The app opens it through the `kiosk-wifi://` link,
  which Chromium's managed policy (`AutoLaunchProtocolsFromOrigins` in
  `pi/rootfs/etc/chromium/policies/managed/kiosk.json`) allows without a prompt only from `https://the-max-mix.vercel.app`.
  The flashed image also has SSH off and no password for any account. See [`pi/wifi-panel/README.md`](pi/wifi-panel/README.md).
