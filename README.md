# THE MAX MIX

A music-first Spotify touchscreen for a Raspberry Pi, including the Waveshare
7-inch 1024x600 display. It is designed for tablet-sized touch screens only;
phone and desktop layouts are not supported.

## What works

- Display the active Spotify track, progress, device, and upcoming queue.
- Play, pause, skip, seek, adjust supported device volume, and transfer playback
  using Spotify's real APIs. Device restrictions and API failures are shown.
  Previous restarts the song when it is more than 5 seconds in, and goes to the
  song before it only within the first 5 seconds.
- **Browser mode** registers Chromium as THE MAX MIX, a Spotify Connect player.
  Select it in the speakers drawer before playing; opening the UI does not steal playback.
- **Remote mode** controls an existing Spotify Connect device without loading
  the Web Playback SDK or requiring DRM on the Pi.

Spotify Premium and access to a Spotify developer app are required for real
playback. Browser streaming also requires a working encrypted-media/Widevine
setup on the exact Pi OS/Chromium image. Validate audio on the device; kiosk mode
alone does not make DRM available.

### The screen

The player is laid out for the 1024x600 panel. On a bigger screen the kiosk scales the whole page up to fit, drawn at
the screen's own resolution, so a 10.1-inch 1280x800 screen shows the same layout 1.25 times as big. A square artwork sits on the left, as wide as the room is tall minus the
control bar, so the cover is never stretched into a strip. The song title and artist and the upcoming queue are beside
it. One bar across the bottom holds the seek bar with the elapsed and total time, the previous, play/pause and next
buttons, the volume slider, and, at the bottom left, the device that is playing. Tap that to open the speakers drawer
(see below). The clock is in the top right of the header.
Playback problems show in a banner at the top, with buttons to fix them.

Tap a song in the queue to play it. Spotify's public API cannot start a queue item directly, so the app skips forward
past the songs before it, one at a time, which also takes them out of the queue. Removing or reordering queue items is
not possible with the public API; do that in the Spotify app.

### The speakers drawer

Tapping the device indicator at the bottom left of the control bar opens a drawer above it. It lists the Spotify Connect
devices, with the one that is playing first and marked Playing. On the kiosk they fill the left column, with the Sonos
rooms, and the AirPlay and Bluetooth speakers fill the right. Tapping
outside the drawer, the close button or Escape closes it.

### How playback is controlled

In browser mode (the default, and the fallback when the browser cannot play) this page is the speaker: it registers a Spotify Connect device called "The Max Mix"
with the Web Playback SDK and drives it directly. The SDK reports every change as an event, so while this page is the
player there is no polling: the play/pause button, progress and track follow the events at once. A slow safety-net
refresh from the Web API catches anything missed. The first Play press makes it the active device (pressing, not
loading the page, so it never takes over what is playing elsewhere). If you pick another device in the speakers drawer (or
the browser cannot play audio), the page is that device's remote and polls the Web API until you pick "The Max Mix"
again. Browsers only start audio after a click, so the very first Play press is also what unlocks sound.
If Spotify provides a retry deadline, Web API playback, queue and device requests all wait for it. Status reads
resume after the wait; failed controls are not automatically sent again. Active SDK controls remain independent
of this Web API cooldown.

On the Pi kiosk, the speakers drawer also switches between two playback modes. **Spotify Connect** is the above: the tablet plays,
or Spotify moves playback to a Connect speaker. **AirPlay** keeps playback on the tablet and the Pi sends its sound on
to the AirPlay speakers you pick (Sonos included), several at once, through PipeWire. The AirPlay speakers stay disabled
until this tablet is the device that is playing, so choose This tablet first. The speakers are the audio
AirPlay sinks PipeWire made; picking them asks the Pi's local
[audio service](pi/kiosk-audio/README.md) (127.0.0.1, answering only the app) to route the sound.

### Wi-Fi from any phone (hotspot)

The Wi-Fi setup page also has a **Hotspot** button that works with any phone, an iPhone too, and needs no app. The tablet
starts a temporary Wi-Fi network and shows two QR codes. Scan the first with the phone's camera to join it; the phone then
opens a page by itself (or scan the second code) where you choose your Wi-Fi and type its password on the phone. The
kiosk joins it, and the tablet's page closes. The hotspot replaces the kiosk's current Wi-Fi while it is up, ends by
itself after 10 minutes, and shows its own random password under the first code. How it works is in
[pi/kiosk-audio](pi/kiosk-audio/README.md).

### Wi-Fi from an Android phone (Bluetooth)

When the Pi has no network, the tablet shows a Wi-Fi setup page. Instead of typing the password there, tap **From phone**,
then on an Android phone with Chrome open [improv-wifi.com](https://www.improv-wifi.com), tap _Connect device_, choose
THE MAX MIX and enter the network and its password. The tablet's page closes when the phone has joined. It only works
for the 5 minutes after the tap, and an iPhone cannot do it (Safari has no Web Bluetooth). How it works is in
[pi/kiosk-audio](pi/kiosk-audio/README.md).

### Bluetooth speakers

On the kiosk, the Speakers drawer has a Bluetooth section below AirPlay. Put the speaker in pairing mode and tap **Find
speakers**, then **Pair** next to it; **Forget** removes it. A connected speaker is listed with the AirPlay speakers
above, where you pick it and set its volume. Like AirPlay it plays what this tablet plays, so choose This tablet first,
and it plays to one Bluetooth speaker at a time. It reconnects by itself when it is switched on again. The kiosk
service does the pairing ([pi/kiosk-audio](pi/kiosk-audio/README.md)).

### Native Spotify Jam limitations

Start a Jam, invite friends, manage guest permissions, reorder songs, and end the
Jam **in the official Spotify app**. This display reads the playback queue and
controls the active device. The public API does not expose Jam membership,
contributor identities, Jam status, or live queue reordering.

Guests add songs through the Spotify app. This page sees queue changes when the track changes and through the SDK's
upcoming-tracks list, so a guest add can take a moment to show.

### Choosing music

The library button in the header opens **Choose music**: Liked Songs and your playlists, or the tracks played recently.
Tapping one starts it on this tablet (or on the speaker picked under Speakers); a recent track carries on with the album
or playlist it was played from. This needs the
`user-read-recently-played` and `playlist-read-private` scopes, so a login from before them has to sign in again in
Settings.

### Lyrics

Tap the artwork (the microphone button in its corner) to show the current song's lyrics in place of the artwork; tap
the picture button to bring the artwork back. The choice is remembered. Lyrics come from [LRCLIB](https://lrclib.net),
a free, open lyrics database that needs no key and allows browser requests. When LRCLIB has no synced lyrics for a
song, the kiosk service (`GET /lyrics`, see [pi/kiosk-audio](pi/kiosk-audio/README.md)) looks for them at NetEase
Cloud Music, QQ Music and KuGou, which do not allow requests from a web page; off the kiosk that step is skipped.
Time-synced lyrics follow playback and keep the current line in the middle. Scrolling them pauses that, and they follow
the song again after 8 seconds of being left alone. Songs with only plain lyrics show them unsynced. Lookups happen only
while the lyrics are shown, once per track. Another source can be added as a `LyricsProvider`
(`src/lyrics/types.ts`) in the list in `src/lyrics/providers.ts`; the sources are asked in order and the first one with
synced lyrics wins, with plain lyrics as the fallback.

Spotify's own lyrics are not used: they come from an internal endpoint that is not part of the public Web API, needs
a signed-in web-player cookie (`sp_dc`) and a server to call it, and is against Spotify's terms.

### Debug console

Hold the clock in the top right for two seconds (or press Ctrl+Shift+D with a keyboard) to open a hidden debug console.
It shows the app's state (version, connection, sign-in, playback mode, audio route, the browser player's device, the
active device and whether Widevine works) and a log of recent problems, browser player events and console errors,
newest first. The playback banner's Details button opens it too. The log lives in memory, keeps the last 200 entries, and is cleared by a reload.

Two switches at the top of the log (remembered across reloads) log every HTTP call the page makes: **Log every HTTP call
and response** writes a line for each request and for its response or failure, and **Include headers** adds their headers.
Credentials are replaced with `[redacted]` (the `Authorization` and cookie headers, and query values such as `code` or
tokens), and only the response headers the browser lets the page read are shown. Leave them off normally: the polling
makes a call every few seconds, which fills the 200-entry log quickly. While logging is on, **Calls to log** lists the
kinds of call (the Spotify playback poll, the queue, Spotify commands and sign-in, the kiosk's speaker list and
heartbeat, lyrics, other kiosk calls, everything else); untick a kind to mute it. The choice is remembered across reloads.

## Hosting and releases

THE MAX MIX is plain static files on a self-hosted server. Production deploys happen only from a release:
[`release.yml`](.github/workflows/release.yml) runs when a version tag is pushed (or by hand for an existing tag), builds
the app on the GitHub runner, joins the tailnet and copies `dist/` to the server with `rsync`, into
`/srv/releases/the-max-mix/<commit>`, and then points `/srv/sites/the-max-mix` at it. A merge to `main` does not change
production.

Set it up once:

1. In Tailscale, let the workflow join the tailnet with its GitHub identity (the OAuth client and audience in
   `release.yml`, tagged `tag:ci`) and let `tag:ci` reach the server over SSH as `deploy`.
2. On the server, serve `/srv/sites/the-max-mix` with every unknown path answered by `/index.html`, a long-lived
   `Cache-Control` for `/assets/` and the response headers listed in [SECURITY.md](SECURITY.md). None of this is in
   the repository.
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

Open **<http://127.0.0.1:5173/>**; the dev server uses exactly that address and port (it stops rather than choosing another port).
Register `http://127.0.0.1:5173/` as a redirect URI in the Spotify dashboard to sign in during development.

To try the production build (the same files the Pi serves), run
`npm run build && npm start` and open
**<http://127.0.0.1:4173/>** (`vite preview`). Register that address too if you want to sign in there. `npm test` runs the
app, kiosk service and sign-in keyboard tests.

### Checks and Git hooks

`npm run check` runs the checks CI's Lint workflow runs, among them ESLint, TypeScript, Prettier (`npm run format`
fixes), ShellCheck, spelling, markdownlint and Stylelint. ShellCheck and editorconfig-checker are system
tools, not npm packages: install them with `brew` or `apt`.

`npm install` at the repo root also installs a [Husky](https://typicode.github.io/husky/) pre-commit hook. For staged
files, lint-staged formats them with Prettier, lints them with ESLint and checks shell
scripts with ShellCheck when it is installed. Type checking covers the whole project, so it only runs in CI. The hook is
skipped automatically when there is no `.git` directory or when dev dependencies are absent (CI). Set
`HUSKY=0` or use `git commit --no-verify` to bypass it.

## Spotify configuration

1. Create an app in the [Spotify developer dashboard](https://developer.spotify.com/dashboard).
2. Register the redirect URI **exactly**, including the trailing slash:
   - `https://the-max-mix.vorkinn.org/` (the deployed app, which is also the kiosk's `kiosk_url`) for the Raspberry Pi
     kiosk and for signing in on the deployed site;
   - `http://127.0.0.1:5173/` for local development, and `http://127.0.0.1:4173/` for `npm start`.
3. The client ID is a constant in `src/spotify/settings.ts`; users never type it in. To use another Spotify app, change
   it there.
4. Choose **Connect Spotify** in the browser that will play (on the kiosk, the Pi's Chromium).
5. Tap the device indicator at the bottom left to open the speakers drawer, then select This tablet, an AirPlay speaker (kiosk only, several at once) or a Spotify Connect device. Press
   Play when ready. For a Connect device, first open Spotify on it so it is discoverable.

There is no backend and no client secret. Sign-in uses the Authorization Code flow with PKCE, which Spotify provides
for apps that cannot keep a secret: the browser creates a one-time code verifier for each sign-in, sends only its
SHA-256 hash to Spotify, and proves it holds the verifier when exchanging the code. The client ID is public by design,
so building it into the site is fine.

The refresh token is kept in the browser's `localStorage`, and the page calls the Spotify Web API directly. The
trade-offs:

- Clearing the site data signs you out; sign in again.
- **Sign out** in Settings drops the stored login, the cached access token and any sign-in left half done. Spotify itself
  may still remember the person in the browser, so the next sign-in asks Spotify to show its approval page again
  (`show_dialog=true`, until a sign-in goes through) rather than letting it sign the same account straight back in; the
  app cannot sign the person out of Spotify's own website.
- There is one login per browser profile.
- Anyone with access to the kiosk's browser profile has the Spotify login. See [SECURITY.md](SECURITY.md).

A login saved for a different client ID is ignored. Access tokens are short-lived and not stored.

Choose remote mode if the Pi should only control another player or if its
browser cannot stream Spotify audio. Remote mode follows the active device's real
playback state and controls, not the browser player's local state.

Spotify does not accept `localhost` redirect URIs. HTTP is allowed only with a
literal loopback address such as `127.0.0.1`; other redirect addresses require HTTPS. Sign in from the same address you
registered: an address that is not registered cannot sign in.

## Sonos

On the kiosk, the Speakers drawer lists the Sonos rooms on the home network under Spotify Connect, found by the Pi
(`pi/kiosk-audio/sonos.ts`) with the [sonos-ts](https://sonos-ts.svrooij.io) library. Spotify will not move its playback
to a Sonos, so tapping a room has the Pi start the song on screen there, from the point it had reached and with Spotify's
queue after it, through the Spotify account linked in the Sonos app. While that group plays, tapping another room adds it to the group; tapping a room in the group again takes it out,
and taking out the last one pauses it. The change shows at once, and the drawer reads the rooms again until Sonos shows
it too. From then on the tablet shows the group's song, progress and artwork and sends its controls (play, pause, skip,
seek, volume, and music picked in Choose music) to the group through the Pi (`src/hooks/useSonosPlayer.ts`), until
another speaker is picked, which pauses the Sonos. The Pi follows the speakers' own events (on port 6329 on the home
network), so a song change, pause, volume change or regrouping, from the kiosk or the Sonos app, shows on the tablet
straight away. A room is turned down to 25% before music starts on it, if it was
louder. There is no Sonos sign-in: everything stays on the home network, so Sonos is listed on the kiosk only.

## Raspberry Pi kiosk

The kiosk is a Raspberry Pi 4 or 5 with the Waveshare 7-inch 1024x600 touch screen, running the deployed app in Chromium
under the Cage kiosk compositor, with a Wi-Fi setup panel when there is no connection. Flash stock Raspberry Pi OS Lite, add the cloud-init files and
power on; [`pi/cloud-init/README.md`](pi/cloud-init/README.md) covers the setup, handing a Pi over, how the kiosk runs,
SSH, troubleshooting and what is still to be verified on a device.

**[Ansible](https://docs.ansible.com) is the single source of truth** for everything installed and configured on the device:
packages, the `kiosk` user and its service, `kiosk-session`, the local kiosk service, the Wi-Fi panel, the AirPlay
audio routing and PipeWire's AirPlay settings, the Chromium policy, Plymouth, boot settings (`cmdline.txt`, `config.txt`), locale, time zone, unattended upgrades and the update timer.
It is one role, [`ansible/roles/kiosk`](ansible/roles/kiosk), run by [`ansible/local.yml`](ansible/local.yml); its
variables and defaults are in [`defaults/main.yml`](ansible/roles/kiosk/defaults/main.yml). Nothing else configures the
device, so change the role, not the device.

- **Releases** are what deployed devices follow. Push a version tag from `main` (`git tag v1.12.0 && git push origin
v1.12.0`): the Release workflow deploys the web app to the server and, once that has worked, publishes the GitHub release
  for the tag with notes generated from the merged pull requests. That one tag ships both the web app and the Pi, and
  the version in the kiosk's Settings is the release's name.
- **First boot:** cloud-init's `user-data` installs Ansible and runs `ansible-pull` from the latest release, then
  reboots. Reflash only for a fresh device.
- **On-device updates:** `kiosk-pull.timer` runs `/usr/local/sbin/kiosk-pull` 3 minutes after boot and then every 6 hours
  (with up to 10 minutes of random delay), and at once when the kiosk's **Update now** button starts
  `kiosk-pull.service` (through the kiosk-audio service, which also streams the pull's journal to the app). With `kiosk_pull_ref: latest` (the default) it looks up the tag that
  `github.com/nvorkinn/the-max-mix/releases/latest` redirects to (no API call or token) and runs `ansible-pull` at that
  tag. `--only-if-changed` starts the playbook only when the release has changed since the last run, so a check with
  nothing new is a single git fetch, and the playbook applies its slow part only when `ansible/`, `pi/kiosk-audio` or
  `pi/kiosk-keyboard` differ from the last complete run (git's tree ids, kept in `/var/lib/the-max-mix/applied.sha1`; most
  releases only change the web app, which the Pi loads from the internet). `kiosk.service` is rewritten either way,
  because it carries the release the settings show. A deployed Pi therefore gets fixes to the Wi-Fi setup page, the session script, the
  Chromium policy and so on without a reflash. The playbook is idempotent, so repeated runs are safe. To pin one Pi,
  set `kiosk_pull_ref` to a tag (`v1.12.0`), or to a branch to test unreleased work on your own Pi.
- **A failing pull never affects the kiosk.** Nothing depends on `kiosk-pull.service`; a failure is only in the journal
  and the next timer run tries again. A pull never restarts the kiosk either: it leaves a marker when kiosk files changed,
  and `kiosk-restart.timer` restarts the kiosk at 04:30 if the marker is there (a reboot also applies the changes).
- **Check the last pull:** `journalctl -u kiosk-pull -n 100`, and `systemctl list-timers 'kiosk-*'` for the next runs.
  Every pull ends with how long it took. As each playbook task starts, `ansible/callback_plugins/task_progress.py` prints
  how many have run out of the total, which drives the bar on the app's update screen.
- **Roll back:** run the Release workflow by hand (Actions > Release > Run workflow) with the earlier tag. It redeploys
  that version of the web app and marks its release as the latest again, and the Pis return to it at their next pull
  (or straight away with **Update now**). Publishing a newer tag later moves everything forward again.
- **Run it by hand** on a Pi you can log in to, as root, from a clone of the repository:
  `sudo ansible-playbook -c local -i localhost, ansible/local.yml` (which, like a pull, applies only what changed since the
  last complete run; delete `/var/lib/the-max-mix/applied.sha1` to apply everything, and note that it compares committed
  files, not edits in the working tree), or the same pull the timer runs: `sudo systemctl start kiosk-pull`. Add
  `--check --diff` to the playbook run to see what it would change.

The kiosk opens the app with `?kiosk=1` (remembered across the Spotify sign-in redirect; `?kiosk=0` forgets it), which
adds kiosk-only entries to Settings: **Wi-Fi network** (the Pi's Wi-Fi setup page), the release the Pi runs and whether
a newer one is out, **Update now** (which opens the update console), **Restart kiosk**, **Reboot Pi** and **Screen sleep** (how long the screen stays on
without a touch while nothing plays; it always stays on while music plays). These go through the Pi's
[local service](pi/kiosk-audio/README.md).

When the kiosk finds that a newer release is out (or, for a Pi pinned to a branch, a newer commit), a popup asks whether to
**Update now** or **Not now**; it asks once for each new version, and not while the screen sleeps or the speakers or debug dialog is open (it does show over Settings). The kiosk asks GitHub when it starts and again every time Settings opens, so
the answer shown there is fresh (an answer that cannot be had, offline or rate limited, keeps the last one found).
Updating, from the popup or from Settings, opens a full-screen update console. The app connects a WebSocket to the
kiosk service (`ws://127.0.0.1:7341/power/update`); connecting starts the update, and the service sends the journal of
the pull and then of the restart (`journalctl -u kiosk-pull`, `-u kiosk-restart`, with the journal's timestamps) as the
lines are written. The console has no way back while the update runs, because the kiosk restarts by itself when the
update needs it (which ends the connection); if nothing needed a restart, or the update failed, it can be closed.

The moon button beside Settings puts the screen to sleep straight away, even while music plays; only a touch wakes it
(music that starts later does not). The Pi turns its display off a minute after that. While the screen sleeps the app
asks Spotify about playback every 45 seconds instead of every 4 and stops reading the queue, so an idle tablet does not
use up the account's rate limit.

When Spotify answers a 429 with the reason `QUOTA_EXCEEDED` (the quota, which waiting does not lift), the app stops reading
Spotify by itself at once and does not start again until it is restarted (a reload, or Restart kiosk): no polling, and no
read when the page comes back to the front. A banner says so, and the buttons still work. **Poll Spotify for updates** in
Settings turns the timer off by choice: playback is then read when the page opens, after each button press and when the
page returns to the front, not every few seconds.

Spotify's browser API does not let the page read `Retry-After`, so after a 429 with no readable wait the app assumes one:
30 seconds, doubling with every 429 in a row up to 5 minutes. All polling and the controls hold off until it passes
(the banner says "Waiting for Spotify"), and each assumed wait is written to the debug console.

Any change on the device that is not in the role is undone the next time a pull finds changed files (for example, SSH is
switched off again when `kiosk_ssh_enabled` is false). A CI job runs the playbook in a Debian trixie container and checks that it is idempotent;
booting the result on a real Pi is not covered.

References: [Raspberry Pi kiosk guide](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/),
[Spotify redirect requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri),
[Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk).
