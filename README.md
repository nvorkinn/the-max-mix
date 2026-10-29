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

## Local setup

Use Node.js 24 LTS (the minimum).

```bash
npm --prefix client ci
VITE_SPOTIFY_CLIENT_ID=your_client_id npm run build   # the ID is optional; it can be typed into Settings instead
npm start
```

Open **<http://127.0.0.1:3000/>**. For a UI-only demonstration open **<http://127.0.0.1:3000/?demo=true>**; no
Spotify account is needed.

The app is plain static files in `client/dist`. A tiny dependency-free server, `scripts/serve.mjs`, is still needed
because Spotify accepts only an https or loopback (`http://127.0.0.1`) redirect address and the Web Playback SDK needs a
secure context, so the page cannot run from `file://`. It reads `PORT` (default 3000) and `HOST` (default `127.0.0.1`)
and answers `/api/health` for readiness checks.

For frontend development, `npm --prefix client run dev` starts the Vite dev server. `npm test` runs the client and
script tests; `npm run build` checks the frontend production build.

To preview the kiosk on macOS, start the server (`npm start`) and run
`npm run kiosk:mac`. It opens Chromium or Google Chrome fullscreen with the Pi's
flags and a separate profile; quit with Cmd+Q. Set `KIOSK_WINDOWED=true` for a
1024x600 window instead, or `KIOSK_BROWSER`, `KIOSK_URL`, `KIOSK_PROFILE` to
override the defaults. It approximates the Pi's layout only; audio/DRM and touch
still need the device.

### Checks and Git hooks

`npm run check` runs everything CI's Lint workflow runs: `npm run lint` (ESLint with `--max-warnings 0` in `client/` and the repository's own scripts and config files), `npm run typecheck` (TypeScript over JSDoc),
`npm run format:check` (Prettier; `npm run format` fixes) and `npm run lint:shell` (ShellCheck over `scripts/*.sh`).
ShellCheck is a system tool, not an npm package: install it with `brew install shellcheck` or `apt install shellcheck`
(CI pins 0.11.0).

`npm install` at the repo root also installs a [Husky](https://typicode.github.io/husky/) pre-commit hook. For staged
files, lint-staged formats them with Prettier, lints them with ESLint (each package's own config) and checks shell
scripts with ShellCheck when it is installed. Type checking covers the whole project, so it only runs in CI. The hook is
skipped automatically when there is no `.git` directory or when dev dependencies are absent (CI, release builds). Set
`HUSKY=0` or use `git commit --no-verify` to bypass it.

## Spotify configuration

1. Create an app in the [Spotify developer dashboard](https://developer.spotify.com/dashboard).
2. Register the redirect URI **exactly**, including the trailing slash:
   - `http://127.0.0.1:3000/` on the Pi or a Mac (change the port if you change `PORT`);
   - `https://<host>/` when the app sits behind a reverse proxy at a real address.
3. Give the app your client ID, either way:
   - at build time: `VITE_SPOTIFY_CLIENT_ID=your_client_id npm run build` (releases, the container and the kiosk
     do this for you), or
   - by typing it into **Settings** in the app (kept in the browser's `localStorage`).
4. Open Settings **on the Pi's Chromium browser** and sign in. Choose the playback mode there too: browser (the
   default) or remote. Settings also has the demo mode switch; `?demo=true` on the address turns it on for a visit.
5. In Speakers, select THE MAX MIX or an existing Spotify Connect device. Press
   Play when ready. For remote mode, first open Spotify on the target device so it
   is discoverable.

There is no backend and no client secret. Sign-in uses the Authorization Code flow with PKCE, which Spotify provides
for apps that cannot keep a secret: the browser creates a one-time code verifier for each sign-in, sends only its
SHA-256 hash to Spotify, and proves it holds the verifier when exchanging the code. The client ID is public by design,
so baking it into a release or image is fine.

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
registered. Do not sign in from a phone using the Pi's loopback address: it points to the phone.

## Releases

A release is a GitHub Release whose tag starts the Release workflow, which builds the app and attaches the files to it.

1. Make sure the commit you want to release is on `main` and its checks passed. The release workflow does not repeat the
   tests and lint, so this is the only gate.
2. On GitHub, open **Releases > Draft a new release**.
3. In **Choose a tag**, type a new tag such as `v1.2.3` and pick **Create new tag on publish**, with the target set to
   `main` (or the exact commit). For a trial, use `v1.2.3-rc.1` and tick **Set as a pre-release**.
4. Click **Generate release notes** (the categories come from `.github/release.yml`), then **Publish release**.
5. Open the **Release** run under **Actions**. It builds the client, packages the static app and its
   serve script, attests the tarball's build provenance and uploads the files. This takes a minute or less. If a step
   fails, fix the cause and re-run the failed job; uploading again replaces the files.
6. Check the release page. It should list `the-max-mix-v1.2.3.tar.gz`, its `.sha256` and `install-kiosk.sh`. To verify a
   download: `gh attestation verify the-max-mix-v1.2.3.tar.gz --repo nvorkinn/the-max-mix`.
7. Update the Pi with the installer (see [Operations and updates](#operations-and-updates)). The installer's "latest"
   skips pre-releases; pass a tag to install one.

Things to know:

- **The Spotify client ID ships with the release.** Add `SPOTIFY_CLIENT_ID` once under **Settings > Secrets and
  variables > Actions > Variables** (a variable, not a secret: the ID is public and PKCE needs no secret). The workflow
  builds it into the client, so the kiosk needs no client ID prompt. The release job fails at its first step if the
  variable is not set.
- **The tag is the only source of the version.** There is nothing to bump: the `version` fields in the repository's
  `package.json` files are a `0.0.0` placeholder, and the release stamps the real version into the packaged copies.
- **Create the release in the web UI; do not push a bare tag.** Publishing the release creates the tag, and the workflow
  attaches the files to that release. With no release for the tag, the workflow fails with a message saying so.
- **A re-run uses the workflow from the tagged commit.** A fix to the release workflow only applies to a release made on
  a commit that includes it.

The tarball holds the built UI, `scripts/serve.mjs`, the other scripts and docs, so it runs without a build step:
extract it and run `npm start` (Node 24+). The Raspberry Pi installer below uses this tarball. To build one locally,
run `npm run build` and then `bash scripts/package-release.sh v1.2.3`; it is written to `release-out/`.

## Container

Every release also publishes a container image, `ghcr.io/nvorkinn/the-max-mix`, for linux/arm64. It is tagged with the
version and, unless the release is a prerelease, `latest`. The image runs `node scripts/serve.mjs` as a non-root user
and serves the built UI on port 3000. It has no volume and no state: the login lives in each visitor's browser. The
release's client ID is built in (it is not secret; the `SPOTIFY_CLIENT_ID` repository variable the release already needs
is passed as the build argument `SPOTIFY_CLIENT_ID`). Build one yourself with
`docker build --build-arg SPOTIFY_CLIENT_ID=<client ID> -t the-max-mix .`.

```bash
docker run -d --name the-max-mix -p 127.0.0.1:3000:3000 ghcr.io/nvorkinn/the-max-mix:latest
```

Behind a reverse proxy at a real address, serve it over HTTPS and register `https://<host>/` as the redirect URI in the
Spotify dashboard (exact match, trailing slash included). Whoever signs in does so with their own Spotify account, and
each browser keeps its own login. Keep the origin dedicated to this app (see [SECURITY.md](SECURITY.md)).

The [countdown-server](https://github.com/nvorkinn/countdown-server) project runs this image on its dev/QA host at
`spotify.dev.nikolaivorkinn.com`, every one of its dev/QA releases pulls `latest`.

## Raspberry Pi kiosk installation

### 1. Prepare the operating system

Use **Raspberry Pi OS 64-bit Desktop**, a reliable power supply, and a Pi 4 or
newer. Configure Wi-Fi/Ethernet, an ordinary desktop user, and SSH in Raspberry Pi
Imager. Install a system-wide Node.js 24 LTS and npm before running the installer.
The installer checks Node's version but does not download or install Node.

In Raspberry Pi OS settings or `sudo raspi-config`:

- Enable **Desktop Autologin** for the kiosk user.
- Disable **Screen Blanking**.
- Select the intended audio output for browser playback.

Autologin and fullscreen Chromium are appliance conveniences, not a security
boundary. Keep SSH key-protected, restrict physical access, and keep the OS and
browser updated.

### 2. Install a release as the desktop user

The installer downloads a published release, so the Pi needs neither git nor a build toolchain:

```bash
curl -fsSLO https://github.com/nvorkinn/the-max-mix/releases/latest/download/install-kiosk.sh
bash install-kiosk.sh            # the latest release, or: bash install-kiosk.sh v1.2.3
```

`latest` skips prereleases; pass a tag such as `v1.3.0-rc.1` to install one. Releases are
unpacked to `~/the-max-mix/releases/<version>`, and `~/the-max-mix/current` points at the active one
(`KIOSK_INSTALL_DIR` and `KIOSK_REPO` override the location and source). After each install the
three most recently activated releases are kept for quick rollback and the rest are deleted; set
`KIOSK_KEEP_RELEASES` to keep a different number (the active release is always kept).

The installer asks no questions: the release has the Spotify client ID built in (see [Releases](#releases)). Register
`http://127.0.0.1:3000/` as a redirect URI in the Spotify dashboard, open the kiosk and sign in once in Settings.

Do **not** invoke the installer with sudo. It uses sudo only to install OS packages
and the system service. It:

- Downloads the release tarball and verifies its SHA-256 checksum before unpacking; a mismatch
  aborts without changing the installation.
- Installs Chromium and curl. Nothing is built or installed with npm on the device.
- Creates `~/the-max-mix/kiosk.env` with `PORT` and `HOST` only if absent; existing settings are kept
  and shared by every release.
- Renders `the-max-mix.service` with the actual username, install path, and Node path.
- Starts the static server at boot as that non-root user, with automatic restarts.
- Adds a user-managed Chromium service started after desktop login. It preserves
  existing labwc autostart entries and also supplies an XDG autostart entry for
  desktops that use it. Starting the same user service twice is harmless.
- Uses Wayland/labwc on current Raspberry Pi OS, with an X11 fallback.
- Waits for `/api/health` to return success before launching Chromium, with a
  bounded timeout and automatic service retry. The browser keeps its own profile
  under `~/.config/the-max-mix/chromium`, with its sandbox enabled.

Then restart and reboot to check it comes up on its own:

```bash
sudo systemctl restart the-max-mix.service
sudo reboot
```

The service defaults to loopback access. Do not expose port 3000 to the internet:
the app is a single-owner local appliance and the Spotify login sits in the kiosk browser's profile.
Any LAN deployment needs HTTPS in front of it; the installer does not configure that.

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
# Static server and browser logs
journalctl -u the-max-mix.service -f
journalctl --user -u the-max-mix-kiosk.service -f

# Local readiness (also checks that the built frontend exists)
curl --fail http://127.0.0.1:3000/api/health

# Restart the browser from the kiosk user's session
systemctl --user restart the-max-mix-kiosk.service

# Update to the latest release (or roll back with a tag: bash ... v1.2.3); recent releases stay in ~/the-max-mix/releases
bash ~/the-max-mix/current/scripts/install-kiosk.sh
systemctl --user restart the-max-mix-kiosk.service
```

If you change `PORT`, rerun the installer so the browser URL is regenerated, and
register the new exact redirect address (`http://127.0.0.1:<port>/`) in the developer dashboard.
For a manual launcher, `KIOSK_URL`, `KIOSK_PROFILE`, and
`KIOSK_STARTUP_TIMEOUT` (seconds, default 120) can be overridden.

Before leaving the device unattended, verify cold boot without a keyboard,
touch input, actual audio on the selected output, login persistence across a
server restart and reboot (the login is in the browser profile), network recovery, browser restart, and a multi-hour
temperature/memory soak test. These hardware checks cannot be replaced by the
development-machine tests.

References: [Raspberry Pi kiosk guide](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/),
[Spotify redirect requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri),
[Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk).
