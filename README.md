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

### Native Spotify Jam limitations

Start a Jam, invite friends, manage guest permissions, reorder songs, and end the
Jam **in the official Spotify app**. This display reads the playback queue and
controls the active device. The public API does not expose Jam membership,
contributor identities, Jam status, or live queue reordering.

Accordingly, live queues have no invented guest avatars, fake "Live Jam" badge,
drag handles, or pretend play-now action. Playing an arbitrary URI can replace
playback context; this app does not do that under a promise to preserve a Jam
queue. The Jam button explains the supported phone workflow.

The small waveform is decorative, driven by playback state, not an analysis of
Spotify's encrypted audio. Canvas animations stop while hidden or idle where
applicable and respect reduced-motion preferences.

## Local setup

Use Node.js 24 LTS (the minimum).

```bash
npm --prefix client ci
npm --prefix server ci
cp server/.env.example server/.env
chmod 600 server/.env
npm run build
npm start
```

Open **http://127.0.0.1:3000**. For a UI-only demonstration, set `DEMO_MODE=true`
in `server/.env` and restart. Otherwise leave it `false` and configure Spotify.
The server loads this file regardless of the working directory; existing process
environment values take precedence.

For frontend development, `npm --prefix client run dev` proxies API requests to
the separately running server on port 3000. `npm test` runs backend and kiosk
launcher checks; `npm run build` checks the frontend production build.

To preview the kiosk on macOS, start the server (`npm start`) and run
`npm run kiosk:mac`. It opens Chromium or Google Chrome fullscreen with the Pi's
flags and a separate profile; quit with Cmd+Q. Set `KIOSK_WINDOWED=true` for a
1024x600 window instead, or `KIOSK_BROWSER`, `KIOSK_URL`, `KIOSK_PROFILE` to
override the defaults. It approximates the Pi's layout only; audio/DRM and touch
still need the device.

### Checks and Git hooks

`npm run check` runs everything CI's Lint workflow runs: `npm run lint` (ESLint with `--max-warnings 0` in `server/`,
`client/` and the repository's own scripts and config files), `npm run typecheck` (TypeScript over JSDoc),
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
2. Register **exactly** `http://127.0.0.1:3000/api/auth/callback` as its redirect URI.
3. Set the following in `server/.env` (`~/the-max-mix/server.env` on an installed kiosk):

   ```ini
   SPOTIFY_CLIENT_ID=your_client_id
   SPOTIFY_CLIENT_SECRET=your_client_secret
   SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/callback
   DEMO_MODE=false
   PLAYBACK_MODE=browser
   HOST=127.0.0.1
   PORT=3000
   ```

4. Restart the server and sign in through Settings **on the Pi's Chromium browser**.
5. In Speakers, select THE MAX MIX or an existing Spotify Connect device. Press
   Play when ready. For remote mode, first open Spotify on the target device so it
   is discoverable.

Set `PLAYBACK_MODE=remote` if the Pi should only control another player or if its
browser cannot stream Spotify audio. Remote mode follows the active device's real
playback state and controls, not the browser player's local state.

Spotify no longer accepts `localhost` redirect URIs. HTTP is allowed only with a
literal loopback address such as `127.0.0.1`; other callbacks require HTTPS. Use the
same hostname for sign-in and callback so the OAuth state cookie matches. Do not
sign in from a phone using the Pi's loopback callback: it points to the phone.

The server also protects itself from other websites open in a browser on the same network. State-changing
requests must be same-origin JSON, and requests are refused unless the `Host` header is an IP address, `localhost`, the
machine's own name (`<hostname>` or `<hostname>.local`), or a name listed in `ALLOWED_HOSTS` (comma-separated, in
`server/.env`). Open the app by IP address or add any custom DNS name to `ALLOWED_HOSTS`; otherwise you will see a 403
"Unrecognized host name" page.

Refresh tokens are saved atomically with owner-only permissions in
`~/.local/share/the-max-mix/spotify-token.json`, or `DATA_DIR` when configured.
Access tokens and the client secret are not written to that file. The installed
system service instead uses `/var/lib/the-max-mix`. Sign in after installing the
service; a previous manual-development login is not automatically migrated.
Revoked logins require signing in again. Never commit `.env` or token files.

## Releases

A release is a GitHub Release whose tag starts the Release workflow, which builds the app and attaches the files to it.

1. Make sure the commit you want to release is on `main` and its checks passed. The release workflow does not repeat the
   tests and lint, so this is the only gate.
2. On GitHub, open **Releases > Draft a new release**.
3. In **Choose a tag**, type a new tag such as `v1.2.3` and pick **Create new tag on publish**, with the target set to
   `main` (or the exact commit). For a trial, use `v1.2.3-rc.1` and tick **Set as a pre-release**.
4. Click **Generate release notes** (the categories come from `.github/release.yml`), then **Publish release**.
5. Open the **Release** run under **Actions**. It builds the client, packages the server with its production
   dependencies, attests the tarball's build provenance and uploads the files. This takes a minute or less. If a step
   fails, fix the cause and re-run the failed job; uploading again replaces the files.
6. Check the release page. It should list `the-max-mix-v1.2.3.tar.gz`, its `.sha256` and `install-kiosk.sh`. To verify a
   download: `gh attestation verify the-max-mix-v1.2.3.tar.gz --repo nvorkinn/the-max-mix`.
7. Update the Pi with the installer (see [Operations and updates](#operations-and-updates)). The installer's "latest"
   skips pre-releases; pass a tag to install one.

Things to know:

- **The tag is the only source of the version.** There is nothing to bump: the `version` fields in the repository's
  `package.json` files are a `0.0.0` placeholder, and the release stamps the real version into the packaged copies.
- **Create the release in the web UI; do not push a bare tag.** Publishing the release creates the tag, and the workflow
  attaches the files to that release. With no release for the tag, the workflow fails with a message saying so.
- **A re-run uses the workflow from the tagged commit.** A fix to the release workflow only applies to a release made on
  a commit that includes it.

The tarball holds the built UI, the server with production dependencies, the scripts and docs, so it runs without a
build step: extract it, create `server/.env` from `server/.env.example`, and run `npm start` (Node 24+). The Raspberry Pi
installer below uses this tarball. To build one locally, run `npm run build` and then
`bash scripts/package-release.sh v1.2.3`; it is written to `release-out/`.

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

Do **not** invoke the installer with sudo. It uses sudo only to install OS packages
and the system service. It:

- Downloads the release tarball and verifies its SHA-256 checksum before unpacking; a mismatch
  aborts without changing the installation.
- Installs Chromium and curl. Nothing is built or installed with npm on the device.
- Creates `~/the-max-mix/server.env` with mode 0600 only if absent; existing configuration is kept
  and shared by every release through a symlink.
- Renders `the-max-mix.service` with the actual username, install path, and Node path.
- Starts the server at boot as that non-root user, with automatic restarts and
  a private persistent token directory.
- Adds a user-managed Chromium service started after desktop login. It preserves
  existing labwc autostart entries and also supplies an XDG autostart entry for
  desktops that use it. Starting the same user service twice is harmless.
- Uses Wayland/labwc on current Raspberry Pi OS, with an X11 fallback.
- Waits for `/api/health` to return success before launching Chromium, with a
  bounded timeout and automatic service retry. The browser keeps its own profile
  under `~/.config/the-max-mix/chromium`, with its sandbox enabled.

Edit `~/the-max-mix/server.env` with your credentials and desired playback mode, then:

```bash
sudo systemctl restart the-max-mix.service
sudo reboot
```

The service defaults to loopback access. Do not expose port 3000 to the internet:
the app is a single-owner local appliance, not a multi-user authenticated service.
Any LAN deployment needs access control and HTTPS in front of it; the installer
does not configure those.

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
# Server and browser logs
journalctl -u the-max-mix.service -f
journalctl --user -u the-max-mix-kiosk.service -f

# Local readiness (also checks that the built frontend exists)
curl --fail http://127.0.0.1:3000/api/health

# Restart the browser from the kiosk user's session
systemctl --user restart the-max-mix-kiosk.service

# Update to the latest release (or roll back with a tag: bash ... v1.2.3) without
# resetting login or config; recent releases stay in ~/the-max-mix/releases
bash ~/the-max-mix/current/scripts/install-kiosk.sh
systemctl --user restart the-max-mix-kiosk.service
```

If you change `PORT`, rerun the installer so the browser URL is regenerated, and
update the exact Spotify callback in both `.env` and the developer dashboard.
For a manual launcher, `KIOSK_URL`, `KIOSK_PROFILE`, and
`KIOSK_STARTUP_TIMEOUT` (seconds, default 120) can be overridden.

Before leaving the device unattended, verify cold boot without a keyboard,
touch input, actual audio on the selected output, login persistence across a
server restart and reboot, network recovery, browser restart, and a multi-hour
temperature/memory soak test. These hardware checks cannot be replaced by the
development-machine tests.

References: [Raspberry Pi kiosk guide](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/),
[Spotify redirect requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri),
[Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk).
