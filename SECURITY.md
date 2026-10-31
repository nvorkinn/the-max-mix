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
- **The kiosk's playbook.** Ansible is the single source of truth for the device, and a systemd timer on the Pi runs
  `ansible-pull` as root against this repository's latest GitHub release (`kiosk_pull_ref: latest`). Whoever can push a
  `v*` tag, publish a release or mark one as the latest can change what runs on every deployed Pi, so protect the
  repository and its tag rules, and only tag commits on `main`. The `kiosk` user has no password, no
  `sudo` and no SSH; Chromium keeps its sandbox enabled. The `admin` account has no password either: SSH lets it in
  by key only (the keys of the GitHub account in `kiosk_admin_github_user`, fetched at every pull), and it has `sudo`.
  Whoever can add a key to that GitHub account can log in to the Pi.
- **The app is public static code.** Anyone who runs it can sign in with their own Spotify account, and each browser
  keeps its own login; a shared browser profile is a shared login. Only addresses registered as redirect URIs in the
  Spotify dashboard can sign in.
- **The audio routing.** `pi/kiosk-audio/` runs as the `kiosk` user and opens no network port. Only the app's origin
  may open `kiosk-audio://` links (Chromium's `AutoLaunchProtocolsFromOrigins`); the handler accepts only
  `kiosk-audio://route` with at most 16 short speaker names, and all it can do is link the browser's audio stream to
  PipeWire sinks with `pw-link`, run by absolute path without a shell. To list the speakers by name, the app's origin
  is granted microphone permission (`AudioCaptureAllowedUrls`), which Chromium requires before it names audio outputs;
  the kiosk has no microphone. Node comes from NodeSource's apt archive (Debian's is too old to run TypeScript), whose
  signing key the playbook pins by checksum; that archive is trusted like Debian's and Raspberry Pi's.
- **Restart and reboot.** The Restart kiosk and Reboot Pi buttons in the app's kiosk settings open
  `kiosk-power://restart` and `kiosk-power://reboot`, which only the app's origin may open without a prompt. The handler
  accepts only those two links, and a polkit rule (`50-kiosk-power.rules`) lets the `kiosk` user restart
  `kiosk.service` and reboot, and nothing else to do with units or power. A page on the app's origin can therefore
  restart or reboot the kiosk, which is a nuisance at worst.
- **The Wi-Fi panel.** A native Qt panel (`pi/wifi-panel/`) runs as the non-root `kiosk` user and joins networks with
  `nmcli`; a polkit rule (`pi/rootfs/etc/polkit-1/rules.d/50-kiosk-networkmanager.rules`) lets only that user manage
  NetworkManager connections. The password reaches `nmcli` on stdin, never in argv, and is not logged; every call is an
  argument list with no shell, and the panel has no network listener. The app opens it through the `kiosk-wifi://` link,
  which Chromium's managed policy (`AutoLaunchProtocolsFromOrigins` in
  `pi/rootfs/etc/chromium/policies/managed/kiosk.json`) allows without a prompt only from `https://the-max-mix.vercel.app`.
  A kiosk has no password for any account, and SSH only by key for `admin`. See [`pi/wifi-panel/README.md`](pi/wifi-panel/README.md).
