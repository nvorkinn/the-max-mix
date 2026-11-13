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
- **The refresh tokens live in the browser.** One per person who signed in on the kiosk is stored in the browser's
  `localStorage` (key `maxmix.people`, with their Spotify ID, name and picture) and the page calls the Spotify Web API
  directly. Anyone who can use the kiosk's browser profile, or read its files, has the
  Spotify login. Treat the device and its profile like the account: restrict physical access, keep SSH key-protected and
  keep the OS and browser updated. Signing out in Settings removes every token, and you can revoke the app under your
  Spotify account's apps. Access tokens are short-lived and kept in memory only.
- **Cross-site scripting matters more.** Script running in the page's origin can read `localStorage`. The app renders
  Spotify's text as plain text and ships no user-supplied HTML, but keep the origin dedicated: do not host other apps
  on the same origin, and keep dependencies up to date. The site sets `X-Content-Type-Options`,
  `Referrer-Policy`, anti-framing headers and a Content-Security-Policy (in the web server's configuration, not in this repository). The full policy is
  report-only for now: violations show in the debug console (source "csp") until it is checked on a Pi and enforced.
- **The kiosk's playbook.** Ansible is the single source of truth for the device, and a systemd timer on the Pi runs
  as root the Pi bundle attached to this repository's latest GitHub release (`kiosk_pull_ref: latest`). Whoever can push a
  `v*` tag, publish a release, upload a release asset or mark a release as the latest can change what runs on every deployed Pi, so protect the
  repository and its tag rules. The Release workflow refuses a tag that is not on `main` or whose `main` CI has not
  passed. The `kiosk` user has no password, no
  `sudo` and no SSH; Chromium keeps its sandbox enabled. The `admin` account has no password either: SSH lets it in
  by key only (the keys of the GitHub account in `kiosk_admin_github_user`, fetched at every pull), and it has `sudo`.
  Whoever can add a key to that GitHub account can log in to the Pi.
- **The app is public static code.** Anyone who runs it can sign in with their own Spotify account, and each browser
  keeps its own login; a shared browser profile is a shared login. Only addresses registered as redirect URIs in the
  Spotify dashboard can sign in.
- **The kiosk's local service.** `pi/kiosk-audio/` runs as the `kiosk` user and listens on 127.0.0.1:7341 only (the unit
  also denies every other address). It answers the app's origin alone: CORS names that origin, and every POST and every
  WebSocket without its `Origin` header is refused (browsers do not apply CORS to a WebSocket), so no other web page can
  trigger an action. A request names one of a few fixed actions and carries no command: update (a WebSocket that streams
  the pull's and the restart's journal), restart or reboot the Pi, turn the screen on, show the Wi-Fi setup page, or route the
  sound to at most 16 speaker names. Routing only links the browser's audio stream to PipeWire sinks with `pw-link`;
  commands run by absolute path with an argument list and no shell. The polkit rule (`50-kiosk-power.rules`) lets the
  `kiosk` user restart `kiosk.service`, start `kiosk-pull.service` and `kiosk-restart.service`, and reboot, and nothing
  else to do with units or power. The `kiosk` user is in the `systemd-journal` group, so it can read the journal (which
  holds the output of the pull, not secrets). A page on the app's origin can therefore restart or reboot the kiosk, which is a nuisance at worst. Node comes
  from NodeSource's apt archive (Debian's is too old to run TypeScript), whose signing key the playbook pins by checksum;
  that archive is trusted like Debian's and Raspberry Pi's. The service's one npm package, `ws`, is installed with
  `npm ci` from a committed lockfile (`ansible/roles/kiosk/files/kiosk-audio/package-lock.json`, integrity-checked and
  watched by Dependabot) with install scripts off.
- **The Wi-Fi setup page.** The local service above serves it on `127.0.0.1:7341/wifi-setup` and joins networks with
  `nmcli` as the non-root `kiosk` user; a polkit rule (`50-kiosk-networkmanager.rules`, installed by the Ansible role)
  lets only that user manage NetworkManager connections. Joining a network (`POST /wifi/connect`) answers only the
  page's own origin, not the app's or any other web page's. The password reaches `nmcli` on stdin, never in argv, and is
  not logged; every call is an argument list with no shell. The app asks the local service to show the page. A kiosk
  has no password for any account, and SSH only by key for `admin`. See [`pi/kiosk-audio/README.md`](pi/kiosk-audio/README.md).
