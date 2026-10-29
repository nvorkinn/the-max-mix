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

## Hosting and releases

THE MAX MIX is plain static files on [Vercel](https://vercel.com). Production deploys happen only from a release:
[`release.yml`](.github/workflows/release.yml) runs when a version tag is pushed (or by hand for an existing tag), builds
the app (`npm ci && npm run build`, with the version set from the tag) and deploys it to Vercel production with the Vercel
CLI. `vercel.json` turns off Vercel's own deploy of `main` (`git.deploymentEnabled`), so a merge to `main` does not
change production; pull requests still get preview deployments. The build settings, the single-page rewrite and the
response headers are in [`vercel.json`](vercel.json).

Set it up once:

1. In the GitHub repository add the secrets `VERCEL_TOKEN` (a Vercel access token), `VERCEL_ORG_ID` and
   `VERCEL_PROJECT_ID` (both in the project's `.vercel/project.json` after `vercel link`, or in the Vercel dashboard).
   The workflow fails with a clear message if one is missing.
2. In the Vercel dashboard (**Settings > Git**) check that pushes to the production branch no longer deploy `main`.
3. Push a tag to release: `git tag v1.2.3 && git push origin v1.2.3`.
4. Register the redirect URI of any address you sign in from in the Spotify dashboard (see
   [Spotify configuration](#spotify-configuration)).

The Raspberry Pi kiosk opens the deployed app (see [Raspberry Pi kiosk installation](#raspberry-pi-kiosk-installation)), so
a release is also how a change reaches the kiosk.

## Local development

Use Node.js 24 LTS (the minimum).

```bash
npm ci
npm run dev
```

Open **<http://127.0.0.1:5173/>**; the dev server uses exactly that address and port (it stops rather than choosing
another port). For a UI-only demonstration open **<http://127.0.0.1:5173/?demo=true>**; no Spotify account is needed.
Register `http://127.0.0.1:5173/` as a redirect URI in the Spotify dashboard to sign in during development.

To try the production build (the same files the Pi serves), run
`npm run build && npm start` and open
**<http://127.0.0.1:4173/>** (`vite preview`). Register that address too if you want to sign in there. `npm test` runs the
app and kiosk script tests; `npm run build` checks the frontend production build.

To preview the kiosk on macOS run `npm run kiosk:mac`. It opens Chromium or Google Chrome fullscreen with the Pi's
flags and a separate profile; quit with Cmd+Q. It opens the `vite preview` address (`http://127.0.0.1:4173/`), so run
`npm run build && npm start` first; set `KIOSK_URL` to open another address. Set
`KIOSK_WINDOWED=true` for a 1024x600 window instead, or `KIOSK_BROWSER`, `KIOSK_PROFILE` to override the defaults. It
approximates the Pi's layout only; audio/DRM and touch still need the device.

### Checks and Git hooks

`npm run check` runs everything CI's Lint workflow runs: `npm run lint` (ESLint with `--max-warnings 0` over the app in `src/` and the repository's own scripts and config files),
`npm run typecheck` (TypeScript; the plain-JavaScript tooling files are checked through their JSDoc),
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
   - `https://the-max-mix.vercel.app/` (the deployed app, which is also the kiosk's `kiosk_url`) for the Raspberry Pi
     kiosk and for signing in on the deployed site;
   - `http://127.0.0.1:5173/` for local development, and `http://127.0.0.1:4173/` for `npm start`.
3. The client ID is a constant in `src/spotify/settings.ts`; users never type it in. To use another Spotify app, change
   it there.
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
registered: an address that is not registered cannot sign in.

## Raspberry Pi kiosk installation

The Pi runs Chromium in fullscreen kiosk mode and opens the deployed app on Vercel (the address of the `release.yml`
deployment). An [Ansible](https://docs.ansible.com) playbook in [`ansible/`](ansible), run on the Pi with `ansible-pull`,
sets it all up. The Pi needs no Node.js and no build, and runs no server of its own.

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

### 2. Run the playbook as the desktop user

On the Pi, as the ordinary desktop user (not root; Raspberry Pi OS lets that user run `sudo` without a password, which
the playbook uses for packages and `raspi-config`; add `--ask-become-pass` if yours asks):

```bash
sudo apt install -y ansible git
ansible-pull -U https://github.com/nvorkinn/the-max-mix.git -C main -d ~/.cache/the-max-mix-ansible \
  -i localhost, ansible/local.yml
```

The kiosk opens `https://the-max-mix.vercel.app/` (the deployed app) unless you pass another `kiosk_url`: `https://`, or `http://127.0.0.1` and
`http://localhost` for testing, without spaces or quotes. Register **exactly that address, trailing slash included,** as
a redirect URI in the Spotify dashboard (`https://the-max-mix.vercel.app/`), then open the kiosk and sign in once in Settings. To
change a setting, put it in `~/the-max-mix-kiosk.yml` (for example `kiosk_url: ...`) and add `-e @$HOME/the-max-mix-kiosk.yml`
to the command, so every pull is repeatable. [`ansible/vars.example.yml`](ansible/vars.example.yml) lists the settings
(`kiosk_url`, `kiosk_user`, `kiosk_startup_timeout`, `kiosk_configure_raspi_config`).

The playbook is idempotent and supports `--check`. It:

- Installs Chromium and curl.
- Copies the kiosk scripts to `~/.local/share/the-max-mix/scripts` and stores the address in
  `~/.config/the-max-mix/kiosk.env` (mode 600).
- Adds the user service `the-max-mix-kiosk.service` (Chromium) and starts it after desktop login: a managed block in the
  labwc autostart that leaves your own entries alone, plus an XDG autostart entry for desktops that use it. Starting the
  same user service twice is harmless. It uses Wayland/labwc on current Raspberry Pi OS, with an X11 fallback.
- Enables lingering for the user, so the user's systemd manager can be reached when a pull runs over SSH or from cron.
- Turns on desktop autologin and turns off screen blanking with `raspi-config nonint` (once, recorded in
  `/var/lib/the-max-mix-kiosk/raspi-config.done`; delete that file to apply them again, or set
  `kiosk_configure_raspi_config: false` to skip them).
- Does not touch `/boot/firmware/config.txt` or the monitor settings (see step 3).

The kiosk waits for the address to answer before launching Chromium, with a bounded timeout and an automatic service
retry. The browser keeps its own profile under `~/.config/the-max-mix/chromium`, with its sandbox enabled, so the login
survives reboots. Then reboot to check it comes up on its own:

```bash
sudo reboot
```

### 3. Configure the touchscreen

Connect the display's HDMI input and USB touch connection. Use the desktop's
display settings to select **1024x600** and the correct orientation. Confirm touch
coordinates match after rotating.

Current Raspberry Pi OS uses KMS. Prefer EDID/desktop configuration; do not copy
old `hdmi_group`, `hdmi_mode`, or `display_rotate` settings into a modern setup.
See `scripts/waveshare-7inch-config.txt` for notes. The playbook intentionally
does not edit `/boot/firmware/config.txt` or overwrite monitor settings.

### Operations and updates

```bash
# Browser logs
journalctl --user -u the-max-mix-kiosk.service -f

# Restart the browser from the kiosk user's session
systemctl --user restart the-max-mix-kiosk.service
```

- **Site updates:** the kiosk opens the live site, so a new release (see [Hosting and releases](#hosting-and-releases))
  reaches the Pi the next time the page loads; restart the service to reload it now. Nothing is installed on the Pi for
  that.
- **Playbook updates and re-runs:** run the same `ansible-pull` command again. It fetches `main`, so use `-C <tag or
branch>` to pin a version of the playbook.
- **Change the address:** set `kiosk_url` in `~/the-max-mix-kiosk.yml` and pull again with `-e @$HOME/the-max-mix-kiosk.yml` (the running kiosk is
  restarted), and register the new address in the Spotify dashboard.
- **Pull on a schedule (optional):** a user crontab line such as
  `17 4 * * 0 ansible-pull -U https://github.com/nvorkinn/the-max-mix.git -C main -d $HOME/.cache/the-max-mix-ansible -i
localhost, ansible/local.yml` (written on one line) applies playbook changes weekly.
- **Roll back:** pin the playbook with `-C <earlier tag or commit>` and pull again. To undo a site release, redeploy the
  previous tag with the Release workflow. To remove the kiosk, delete the autostart block in
  `~/.config/labwc/autostart` and the `~/.config/autostart/the-max-mix-kiosk.desktop` file, then run
  `systemctl --user disable --now the-max-mix-kiosk.service`.

For a manual launcher, `KIOSK_URL`, `KIOSK_PROFILE` and `KIOSK_STARTUP_TIMEOUT` (seconds, default 120) can be set.

Before leaving the device unattended, verify cold boot without a keyboard,
touch input, actual audio on the selected output, login persistence across a
reboot (the login is in the browser profile), network recovery (the page needs the internet), browser restart, and a
multi-hour temperature/memory soak test. These hardware checks cannot be replaced by the development-machine tests.

References: [Raspberry Pi kiosk guide](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/),
[Spotify redirect requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri),
[Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk).
