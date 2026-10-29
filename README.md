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

The Raspberry Pi kiosk opens the deployed app (see [Raspberry Pi kiosk](#raspberry-pi-kiosk)), so a release is also how
a change reaches the kiosk.

## Local development

Use Node.js 24 LTS (the minimum).

```bash
npm ci
npm run dev
```

Open **<http://127.0.0.1:5173/>**; the dev server uses exactly that address and port (it stops rather than choosing
another port). For a UI-only demonstration open **<http://127.0.0.1:5173/?demo=true>**; no Spotify account is needed.
Register `http://127.0.0.1:5173/` as a redirect URI in the Spotify dashboard to sign in during development.

To try the production build, run `npm run build && npm start` and open **<http://127.0.0.1:4173/>** (`vite preview`).
Register that address too if you want to sign in there. `npm test` runs the app tests and the Wi-Fi panel tests;
`npm run build` checks the frontend production build.

### Checks and Git hooks

`npm run check` runs everything CI's Lint workflow runs: `npm run lint` (ESLint with `--max-warnings 0` over the app in `src/` and the repository's own scripts and config files),
`npm run typecheck` (TypeScript over the app and the TypeScript scripts; the few JavaScript config files are checked through their JSDoc),
`npm run format:check` (Prettier; `npm run format` fixes) and `npm run lint:shell` (ShellCheck over the kiosk image and Wi-Fi panel scripts).
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
   - `https://the-max-mix.vercel.app/` (the deployed app) for the Raspberry Pi kiosk and for signing in on the
     deployed site;
   - `http://127.0.0.1:5173/` for local development, and `http://127.0.0.1:4173/` for `npm start`.
3. The client ID is a constant in `src/spotify/settings.ts`; users never type it in. To use another Spotify app, change
   it there.
4. Open Settings **in the browser that will play** (on the kiosk, the Pi's Chromium) and sign in. Choose the playback mode there too: browser (the
   default) or remote. Settings also has the demo mode switch; `?demo=true` on the address turns it on for a visit.
   On the Pi kiosk, which is opened with `?kiosk=1` (the app remembers that, so it survives the Spotify sign-in redirect;
   `?kiosk=0` forgets it), Settings also shows **Wi-Fi network**, which opens the Pi's native Wi-Fi panel (it asks the kiosk
   to open `kiosk-wifi://open`). Other visitors never see the entry.
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

The kiosk is a ready-to-flash image for a Raspberry Pi 4 or 5 with the Waveshare 7-inch touch screen: Raspberry Pi OS
Lite with the [Cage](https://github.com/cage-kiosk/cage) kiosk compositor and Chromium (with Widevine) opening the
deployed app at `https://the-max-mix.vercel.app/?kiosk=1`. Nothing is installed on the Pi, and the Pi runs no server of
its own. How the image is built, what it contains and what is still to be verified is in
[`pi/image/README.md`](pi/image/README.md); the native Wi-Fi setup panel is described in
[`pi/wifi-panel/README.md`](pi/wifi-panel/README.md).

- **Build:** run the [Pi image workflow](.github/workflows/pi-image.yml) from Actions (the image is a workflow artifact),
  or push a `v*` tag to attach the image to the release. To build by hand see `pi/image/README.md`.
- **Flash:** in [Raspberry Pi Imager](https://www.raspberrypi.com/software/) choose **Use custom**, select the unpacked
  `.img` (or `.img.xz`), skip OS customisation (the image sets everything up itself), put the card in the Pi and power on.
- **First boot:** the file system expands and the Pi reboots once. If NetworkManager reports a working connection the app
  opens full screen; otherwise a Wi-Fi setup panel with an on-screen keyboard appears, and the app starts as soon as
  the Pi connects. The app's **Wi-Fi network** setting (kiosk only) opens the same panel later.
- **Spotify:** register `https://the-max-mix.vercel.app/` (trailing slash included) as a redirect URI in the Spotify
  dashboard, then sign in once in the app's Settings. The login is kept in the kiosk's browser profile.
- **Updates:** the kiosk opens the live site, so a new release reaches it the next time the page loads. OS and Chromium
  updates come from unattended upgrades.
- **Touch screen:** `scripts/waveshare-7inch-config.txt` has notes for other display setups.
- **Local preview:** `npm run dev` and open <http://127.0.0.1:5173/?kiosk=1> to see the kiosk-only settings in a browser
  (see [Local development](#local-development)).

Before leaving the device unattended, verify cold boot without a keyboard, touch input, actual audio on the selected
output, login persistence across a reboot (the login is in the browser profile), network recovery (the page needs the
internet), browser restart, and a multi-hour temperature/memory soak test. These hardware checks cannot be replaced by
the development-machine tests.

References: [Raspberry Pi kiosk guide](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/),
[Spotify redirect requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri),
[Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk).
