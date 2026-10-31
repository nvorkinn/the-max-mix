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

In browser mode (the default) this page is the speaker: it registers a Spotify Connect device called "The Max Mix"
with the Web Playback SDK and drives it directly. The SDK reports every change as an event, so while this page is the
player there is no polling: the play/pause button, progress and track follow the events at once. A slow safety-net
refresh from the Web API catches anything missed. The first Play press makes it the active device (pressing, not
loading the page, so it never takes over what is playing elsewhere). If you pick another device under Speakers (or
choose remote mode in Settings), the page is that device's remote and polls the Web API until you pick "The Max Mix"
again. Browsers only start audio after a click, so the very first Play press is also what unlocks sound.

On the Pi kiosk, Speakers also switches between two playback modes. **Spotify Connect** is the above: the tablet plays,
or Spotify moves playback to a Connect speaker. **AirPlay** keeps playback on the tablet and the Pi sends its sound on
to the AirPlay speakers you pick (Sonos included), several at once, through PipeWire. The speakers are the audio
outputs Chromium lists; picking them opens a `kiosk-audio://` link that the Pi's
[audio routing](pi/kiosk-audio/README.md) handles, the same way `kiosk-wifi://` opens the Wi-Fi panel.

### Native Spotify Jam limitations

Start a Jam, invite friends, manage guest permissions, reorder songs, and end the
Jam **in the official Spotify app**. This display reads the playback queue and
controls the active device. The public API does not expose Jam membership,
contributor identities, Jam status, or live queue reordering.

Accordingly, live queues have no invented guest avatars, fake "Live Jam" badge,
drag handles, or pretend play-now action. Playing an arbitrary URI can replace
playback context; this app does not do that under a promise to preserve a Jam
queue.

`TrackQueue` (`src/components/TrackQueue.tsx`) renders both the read-only live queue and the explicitly simulated demo
queue. Guest credits, reordering and play-now controls are demo-only. There is no in-app voting or QR guest remote;
guests manage their contributions in Spotify.

Guests add songs through the Spotify app. This page sees queue changes when the track changes and through the SDK's
upcoming-tracks list, so a guest add can take a moment to show.

### Lyrics

**Lyrics** in the header swaps the queue for the current song's lyrics (and **Up next** swaps back; the choice is
remembered). They come from [LRCLIB](https://lrclib.net), a free, open lyrics database that needs no key and allows
browser requests, so the app still has no backend. Time-synced lyrics follow playback and keep the current line in the
middle; songs with only plain lyrics show them unsynced. Lookups happen only while the lyrics are shown, once per
track. Another source can be added as a `LyricsProvider` (`src/lyrics/types.ts`) in the list in `src/lyrics/providers.ts`;
the sources are asked in order and the first one with lyrics wins.

Spotify's own lyrics are not used: they come from an internal endpoint that is not part of the public Web API, needs
a signed-in web-player cookie (`sp_dc`) and a server to call it, and is against Spotify's terms.

The small waveform is decorative, driven by playback state, not an analysis of
Spotify's encrypted audio. Canvas animations stop while hidden or idle where
applicable and respect reduced-motion preferences.

### Touch and accessibility

Playback, queue and dialog controls have touch areas of at least 44x44 CSS pixels, including the sliders and settings
switches. Secondary text is sized for the 1024x600 kiosk, and browser zoom remains available on phones and computers.
Settings, Speakers and the debug console keep keyboard focus inside while open. Escape closes the topmost dialog
and returns focus to its trigger; background controls cannot be activated through an open dialog.

Missing or failed artwork uses a bundled record icon, and failed demo avatars show the guest's initials. These
placeholders need no network access. Image failures are recorded in the debug log without repeatedly retrying the
failed URL; changing to another image still loads the new source.

### Debug console

Hold the clock in the footer for two seconds (or press Ctrl+Shift+D with a keyboard) to open a hidden debug console.
It shows the app's state (version, connection, sign-in, playback mode, audio route, the browser player's device, the
active device and whether Widevine works) and a log of recent problems, browser player events and console errors,
newest first. Playback errors go there instead of a banner over the screen; while one is current the footer status
turns red and links to it. The log lives in memory, keeps the last 200 entries, and is cleared by a reload.

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

The Raspberry Pi kiosk opens the deployed app (see [Raspberry Pi kiosk](#raspberry-pi-kiosk)), so
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
app, audio routing and Wi-Fi panel tests; `npm run build` checks the frontend production build.

### Checks and Git hooks

`npm run check` runs everything CI's Lint workflow runs: `npm run lint` (ESLint with `--max-warnings 0` over the app in `src/` and the repository's own scripts and config files),
`npm run typecheck` (TypeScript over the app and the TypeScript scripts; the few JavaScript config files are checked through their JSDoc),
`npm run format:check` (Prettier; `npm run format` fixes) and `npm run lint:shell` (ShellCheck over the kiosk shell scripts).
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
   On the Pi kiosk, which is opened with `?kiosk=1` (the app remembers that, so it survives the Spotify sign-in redirect;
   `?kiosk=0` forgets it), Settings also shows **Wi-Fi network**, which opens the Pi's native Wi-Fi panel (it asks the
   kiosk to open `kiosk-wifi://open`). Other visitors never see the entry. The kiosk's Settings also show which release
   the Pi is running (for example `v1.12.0`, from `?pi_ref=&pi_commit=` in `kiosk_url`), say when a newer release is
   on GitHub, and have **Update now**, **Restart kiosk** and **Reboot Pi** buttons (`kiosk-power://` links). **Update
   now** pulls the latest release at once and restarts the kiosk if anything changed; otherwise a new release reaches the
   Pi within about 6 hours and is fully applied after the next kiosk restart: at 04:30, on a reboot, or with the button.
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

## Raspberry Pi kiosk

The kiosk is a Raspberry Pi 4 or 5 with the Waveshare 7-inch 1024x600 touch screen, running the deployed app in Chromium
under the Cage kiosk compositor, with a Wi-Fi setup panel when there is no connection. Flash stock Raspberry Pi OS Lite, add the cloud-init files and
power on; [`pi/cloud-init/README.md`](pi/cloud-init/README.md) covers the setup, handing a Pi over, how the kiosk runs,
SSH, troubleshooting and what is still to be verified on a device.

**[Ansible](https://docs.ansible.com) is the single source of truth** for everything installed and configured on the device:
packages, the `kiosk` user and its service, `kiosk-session`, the `kiosk-wifi://` handler, the Wi-Fi panel, the AirPlay
audio routing and PipeWire's AirPlay settings, the Chromium policy, Plymouth, boot settings (`cmdline.txt`, `config.txt`), locale, time zone, unattended upgrades and the update timer.
It is one role, [`ansible/roles/kiosk`](ansible/roles/kiosk), run by [`ansible/local.yml`](ansible/local.yml); its
variables and defaults are in [`defaults/main.yml`](ansible/roles/kiosk/defaults/main.yml). Nothing else configures the
device, so change the role, not the device.

- **Releases** are what deployed devices follow. Push a version tag from `main` (`git tag v1.12.0 && git push origin
v1.12.0`): the Release workflow deploys the web app to Vercel and, once that has worked, publishes the GitHub release
  for the tag with notes generated from the merged pull requests. That one tag ships both the web app and the Pi, and
  the version in the kiosk's Settings is the release's name.
- **First boot:** cloud-init's `user-data` installs Ansible and runs `ansible-pull` from the latest release, then
  reboots. Reflash only for a fresh device.
- **On-device updates:** `kiosk-pull.timer` runs `/usr/local/sbin/kiosk-pull` 3 minutes after boot and then every 6 hours
  (with up to 10 minutes of random delay), and at once when the kiosk's **Update now** button starts
  `kiosk-update-now.service`. With `kiosk_pull_ref: latest` (the default) it looks up the tag that
  `github.com/nvorkinn/the-max-mix/releases/latest` redirects to (no API call or token) and runs `ansible-pull` at that
  tag. `--only-if-changed` applies the playbook only when the release has changed since the last run, so a check with
  nothing new is a single git fetch. A deployed Pi therefore gets fixes to the Wi-Fi panel, the session script, the
  Chromium policy and so on without a reflash. The playbook is idempotent, so repeated runs are safe. To pin one Pi,
  set `kiosk_pull_ref` to a tag (`v1.12.0`), or to a branch to test unreleased work on your own Pi.
- **A failing pull never affects the kiosk.** Nothing depends on `kiosk-pull.service`; a failure is only in the journal
  and the next timer run tries again. A pull never restarts the kiosk either: it leaves a marker when kiosk files changed,
  and `kiosk-restart.timer` restarts the kiosk at 04:30 if the marker is there (a reboot also applies the changes).
- **Check the last pull:** `journalctl -u kiosk-pull -n 100`, and `systemctl list-timers 'kiosk-*'` for the next runs.
- **Roll back:** run the Release workflow by hand (Actions > Release > Run workflow) with the earlier tag. It redeploys
  that version of the web app and marks its release as the latest again, and the Pis return to it at their next pull
  (or straight away with **Update now**). Publishing a newer tag later moves everything forward again.
- **Run it by hand** on a Pi you can log in to, as root, from a clone of the repository:
  `sudo ansible-playbook -c local -i localhost, ansible/local.yml` (which always applies the playbook), or the same pull
  the timer runs: `sudo systemctl start kiosk-pull` (which does nothing if the latest release has not changed). Add `--check --diff` to
  the playbook run to see what it would change.

Any change on the device that is not in the role is undone at the next pull (for example, SSH is switched off again when
`kiosk_ssh_enabled` is false). A CI job runs the playbook in a Debian trixie container and checks that it is idempotent;
booting the result on a real Pi is not covered.

References: [Raspberry Pi kiosk guide](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/),
[Spotify redirect requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri),
[Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk).
