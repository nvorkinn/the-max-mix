# THE MAX MIX

A music-first Spotify touchscreen for a Raspberry Pi, including the Waveshare
7-inch 1024x600 display. Studio and Paper appearances adapt to tablets,
larger screens, and phones.

## What works

- Display the active Spotify track, progress, device, and upcoming queue.
- Play, pause, skip, seek, adjust supported device volume, and transfer playback
  using Spotify's real APIs. Device restrictions and API failures are shown.
- **Browser mode** registers Chromium as THE MAX MIX, a Spotify Connect player.
  Select it in Speakers before playing; opening the UI does not steal playback.
- **Remote mode** controls an existing Spotify Connect device without loading
  the Web Playback SDK or requiring DRM on the Pi.
- Explicit **demo mode** supplies simulated tracks and a reorderable demo queue.
  Live errors never switch the app into demo mode.

Spotify Premium and access to a Spotify developer app are required for real
playback. Browser streaming also requires a working encrypted-media/Widevine
setup on the exact Pi OS/Chromium image. Validate audio on the device; kiosk mode
alone does not make DRM available.

### How playback is controlled

In browser mode (the default) this page is the speaker: it registers a Spotify Connect device called "THE MAX MIX"
with the Web Playback SDK and drives it directly. The SDK reports every change as an event, so while this page is the
player there is no polling: the play/pause button, progress and track follow the events at once. A slow safety-net
refresh from the Web API catches anything missed. The first Play press makes it the active device (pressing, not
loading the page, so it never takes over what is playing elsewhere). If you pick another device under Speakers (or
choose remote mode in Settings), the page is that device's remote and polls the Web API until you pick "THE MAX MIX"
again. Browsers only start audio after a click, so the very first Play press is also what unlocks sound.

### Native Spotify Jam limitations

Start a Jam, invite friends, manage guest permissions, reorder songs, and end the
Jam **in the official Spotify app**. This display reads the playback queue and
controls the active device. The public API does not expose Jam membership,
contributor identities, Jam status, or live queue reordering.

Accordingly, live queues have no invented guest avatars, fake "Live Jam" badge,
drag handles, or pretend play-now action. Playing an arbitrary URI can replace
playback context; this app does not do that under a promise to preserve a Jam
queue. The Jam button explains the supported phone workflow.

Guests add songs through the Spotify app. This page sees queue changes when the track changes and through the SDK's
upcoming-tracks list, so a guest add can take a moment to show.

The small waveform is decorative, driven by playback state, not an analysis of
Spotify's encrypted audio. Canvas animations stop while hidden or idle where
applicable and respect reduced-motion preferences.

## Hosting

THE MAX MIX is plain static files, hosted by [Vercel](https://vercel.com) at **<https://spotify.dev.nikolaivorkinn.com/>**.
Every browser, the Raspberry Pi kiosk included, opens that address. Nothing of ours runs a server, and the site has no
secrets: each visitor signs in to their own Spotify account.

Set it up once:

1. In Vercel, **Add New > Project** and import this GitHub repository. Vercel reads the build settings from
   [`vercel.json`](vercel.json) in the repository root (the Vite framework preset, install `npm ci`, build
   `npm run build`, output `dist`, plus the single-page rewrite and the response headers), so leave the framework
   preset and the commands as detected.
2. Under **Settings > Environment Variables** add `VITE_SPOTIFY_CLIENT_ID` with your Spotify client ID, for the
   Production environment (and Preview if you want one). It is public by design, not a secret. Without it, the client ID
   can still be typed into Settings in the app.
3. Under **Settings > Domains** add `spotify.dev.nikolaivorkinn.com`. The DNS record is a DNS-only CNAME to
   `cname.vercel-dns.com` (not proxied by Cloudflare), managed in the
   [countdown-server](https://github.com/nvorkinn/countdown-server) project. The `<project>.vercel.app` address works too.
4. Under **Settings > Git** keep the production branch `main`, so every merge to `main` deploys to production.
5. Register the redirect URI in the Spotify dashboard (see [Spotify configuration](#spotify-configuration)).

Pull requests get preview deployments on other addresses. Those are not registered with Spotify, so signing in does not
work on them; the demo mode (`?demo=true`) does.

## Local development

Use Node.js 24 LTS (the minimum).

```bash
npm ci
npm run dev
```

Open **<http://127.0.0.1:5173/>**; the dev server uses exactly that address and port (it stops rather than choosing
another port). For a UI-only demonstration open **<http://127.0.0.1:5173/?demo=true>**; no Spotify account is needed.
Register `http://127.0.0.1:5173/` as a redirect URI in the Spotify dashboard to sign in during development.

To try the production build the way the host serves it, run
`VITE_SPOTIFY_CLIENT_ID=your_client_id npm run build && npm start` (the ID is optional) and open
**<http://127.0.0.1:4173/>** (`vite preview`). Register that address too if you want to sign in there. `npm test` runs the
app, script and kiosk installer tests; `npm run build` checks the frontend production build.

To preview the kiosk on macOS run `npm run kiosk:mac`. It opens Chromium or Google Chrome fullscreen with the Pi's
flags and a separate profile; quit with Cmd+Q. It opens the hosted site by default; set `KIOSK_URL` to a local
`vite preview` address (for example `KIOSK_URL=http://127.0.0.1:4173/ npm run kiosk:mac`) to try a local build. Set
`KIOSK_WINDOWED=true` for a 1024x600 window instead, or `KIOSK_BROWSER`, `KIOSK_PROFILE` to override the defaults. It
approximates the Pi's layout only; audio/DRM and touch still need the device.

### Checks and Git hooks

`npm run check` runs everything CI's Lint workflow runs: `npm run lint` (ESLint with `--max-warnings 0` over the app in `src/` and the repository's own scripts and config files),
`npm run typecheck` (TypeScript over JSDoc),
`npm run format:check` (Prettier; `npm run format` fixes) and `npm run lint:shell` (ShellCheck over `scripts/*.sh`).
ShellCheck is a system tool, not an npm package: install it with `brew install shellcheck` or `apt install shellcheck`
(CI pins 0.11.0).

`npm install` at the repo root also installs a [Husky](https://typicode.github.io/husky/) pre-commit hook. For staged
files, lint-staged formats them with Prettier, lints them with ESLint and checks shell
scripts with ShellCheck when it is installed. Type checking covers the whole project, so it only runs in CI. The hook is
skipped automatically when there is no `.git` directory or when dev dependencies are absent (CI). Set
`HUSKY=0` or use `git commit --no-verify` to bypass it.

## Spotify configuration

1. Create an app in the [Spotify developer dashboard](https://developer.spotify.com/dashboard).
2. Register the redirect URI **exactly**, including the trailing slash:
   - `https://spotify.dev.nikolaivorkinn.com/` for the hosted site (the Pi kiosk uses this too);
   - `https://<project>.vercel.app/` if you also want to sign in at the Vercel address;
   - `http://127.0.0.1:5173/` for local development.
3. Give the app your client ID, either way:
   - the Vercel environment variable `VITE_SPOTIFY_CLIENT_ID` (see [Hosting](#hosting)), or
     `VITE_SPOTIFY_CLIENT_ID=your_client_id npm run build` locally, or
   - by typing it into **Settings** in the app (kept in the browser's `localStorage`).
4. Open Settings **in the browser that will play** (on the kiosk, the Pi's Chromium) and sign in. Choose the playback mode there too: browser (the
   default) or remote. Settings also has the demo mode switch; `?demo=true` on the address turns it on for a visit.
5. In Speakers, select THE MAX MIX or an existing Spotify Connect device. Press
   Play when ready. For remote mode, first open Spotify on the target device so it
   is discoverable.

There is no backend and no client secret. Sign-in uses the Authorization Code flow with PKCE, which Spotify provides
for apps that cannot keep a secret: the browser creates a one-time code verifier for each sign-in, sends only its
SHA-256 hash to Spotify, and proves it holds the verifier when exchanging the code. The client ID is public by design,
so building it into the site is fine.

The refresh token is kept in the browser's `localStorage`, and the page calls the Spotify Web API directly. The
trade-offs:

- Clearing the site data signs you out; sign in again.
- There is one login per browser profile.
- Anyone with access to the kiosk's browser profile has the Spotify login. See [SECURITY.md](SECURITY.md).

A login saved for a different client ID is ignored. Access tokens are short-lived and not stored.

Choose remote mode if the Pi should only control another player or if its
browser cannot stream Spotify audio. Remote mode follows the active device's real
playback state and controls, not the browser player's local state.

Spotify no longer accepts `localhost` redirect URIs. HTTP is allowed only with a
literal loopback address such as `127.0.0.1`; other redirect addresses require HTTPS. Sign in from the same address you
registered: an address that is not registered (a Vercel preview deployment, for example) cannot sign in.

## Raspberry Pi kiosk installation

The kiosk is Chromium in fullscreen opening the hosted site. The Pi needs no Node.js, no git and no build, and runs no
server of its own.

### 1. Prepare the operating system

Use **Raspberry Pi OS 64-bit Desktop**, a reliable power supply, and a Pi 4 or
newer. Configure Wi-Fi/Ethernet, an ordinary desktop user, and SSH in Raspberry Pi
Imager.

In Raspberry Pi OS settings or `sudo raspi-config`:

- Enable **Desktop Autologin** for the kiosk user.
- Disable **Screen Blanking**.
- Select the intended audio output for browser playback.

Autologin and fullscreen Chromium are appliance conveniences, not a security
boundary. Keep SSH key-protected, restrict physical access, and keep the OS and
browser updated.

### 2. Run the installer as the desktop user

From a checkout of this repository, or fetched straight from GitHub:

```bash
bash scripts/install-kiosk.sh
# or, without a checkout:
curl -fsSLO https://raw.githubusercontent.com/nvorkinn/the-max-mix/main/scripts/install-kiosk.sh
bash install-kiosk.sh
```

The kiosk opens `https://spotify.dev.nikolaivorkinn.com/` unless you pass another address:
`KIOSK_URL=https://my-project.vercel.app/ bash install-kiosk.sh`. Only `https` addresses are accepted, plus
`http://127.0.0.1` and `http://localhost` for testing. Register the address you use as a redirect URI in the Spotify
dashboard (exact match, trailing slash included), open the kiosk and sign in once in Settings.

Do **not** invoke the installer with sudo. It uses sudo only to install OS packages. It:

- Installs Chromium and curl. Nothing else is installed or built on the device.
- Copies the kiosk scripts to `~/.local/share/the-max-mix/scripts` (`KIOSK_INSTALL_DIR` changes the place). When it is
  not run from a checkout it downloads them from GitHub (`KIOSK_REPO` and `KIOSK_REF` choose the repository and branch or tag).
- Stores the address in `~/.config/the-max-mix/kiosk.env` (mode 600). It is created on the first install and left alone
  on a re-run, unless `KIOSK_URL` is given again.
- Adds a user-managed Chromium service started after desktop login. It preserves
  existing labwc autostart entries and also supplies an XDG autostart entry for
  desktops that use it. Starting the same user service twice is harmless.
- Uses Wayland/labwc on current Raspberry Pi OS, with an X11 fallback.
- Waits for the address to answer before launching Chromium, with a bounded timeout and automatic service retry. The
  browser keeps its own profile under `~/.config/the-max-mix/chromium`, with its sandbox enabled.

Then reboot to check it comes up on its own:

```bash
sudo reboot
```

### 3. Configure the touchscreen

Connect the display's HDMI input and USB touch connection. Use the desktop's
display settings to select **1024x600** and the correct orientation. Confirm touch
coordinates match after rotating.

Current Raspberry Pi OS uses KMS. Prefer EDID/desktop configuration; do not copy
old `hdmi_group`, `hdmi_mode`, or `display_rotate` settings into a modern setup.
See `scripts/waveshare-7inch-config.txt` for notes. The installer intentionally
does not edit `/boot/firmware/config.txt` or overwrite monitor settings.

### Operations and updates

```bash
# Browser logs
journalctl --user -u the-max-mix-kiosk.service -f

# Restart the browser from the kiosk user's session
systemctl --user restart the-max-mix-kiosk.service
```

There is nothing to update on the Pi: a merge to `main` deploys the site and the kiosk loads it the next time the page is
opened. To point the kiosk at another address, edit `~/.config/the-max-mix/kiosk.env` (or run the installer again with
`KIOSK_URL` set) and restart the service. To change the scripts themselves, run the installer again. For a manual
launcher, `KIOSK_URL`, `KIOSK_PROFILE`, and `KIOSK_STARTUP_TIMEOUT` (seconds, default 120) can be overridden.

Before leaving the device unattended, verify cold boot without a keyboard,
touch input, actual audio on the selected output, login persistence across a
reboot (the login is in the browser profile), network recovery (the page needs the internet), browser restart, and a
multi-hour temperature/memory soak test. These hardware checks cannot be replaced by the development-machine tests.

References: [Raspberry Pi kiosk guide](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/),
[Spotify redirect requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri),
[Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk).
