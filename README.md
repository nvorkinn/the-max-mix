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
- **Browser mode** (on the kiosk) plays through the kiosk's own Spotify Connect
  player, Spotify Soloist, which the Pi runs for the active person under the kiosk's own name
  (`kiosk_name`, or "The Max Mix 4" on host `the-max-mix-4`).
  Select it in the speakers drawer before playing; opening the UI does not steal playback.
- **Remote mode** (anywhere else) controls an existing Spotify Connect device.

Spotify Premium and access to a Spotify developer app are required for real
playback. Playing on the kiosk itself also needs the active person's own Soloist
API key, saved on countdown-server's settings site.

### The screen

The player is laid out for the 1024x600 panel and stretches to a bigger one, such as a 10.1-inch 1280x800 screen, whose
bigger pixels keep every control at least as large as on the 7-inch screen. A square artwork sits on the left, as wide as the room is tall minus the
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

In browser mode (the default on the kiosk) the kiosk is the speaker: the Pi runs Spotify Soloist, a headless Spotify
Connect player, for the active person, and the page drives it through the Pi service's `/soloist` WebSocket. Soloist
reports every change as an event, so while it is the active device there is no polling: the play/pause button, progress
and track follow the events at once. A slow safety-net refresh from the Web API catches anything missed. Soloist's
commands act on whichever device is active, so the page only sends them while Soloist itself is the active device. The
first Play press makes it the active device (pressing, not loading the page, so it never takes over what is playing
elsewhere). If you pick another device in the speakers drawer, the page is that device's remote and polls the Web API
until you pick This tablet again.
If Spotify provides a retry deadline, Web API playback, queue and device requests all wait for it. Status reads
resume after the wait; failed controls are not automatically sent again. Commands to the kiosk's own player remain
independent of this Web API cooldown.

On the Pi kiosk, the speakers drawer also switches between two playback modes. **Spotify Connect** is the above: the tablet plays,
or Spotify moves playback to a Connect speaker. **AirPlay** keeps playback on the tablet and the Pi sends its sound on
to the AirPlay speakers you pick (Sonos included), several at once, through PipeWire. The AirPlay speakers stay disabled
until this tablet is the device that is playing, so choose This tablet first. The speakers are the audio
AirPlay sinks PipeWire made; picking them asks the Pi's local
[audio service](pi/kiosk-audio/README.md) (127.0.0.1, answering only the app) to route the sound.

### Wi-Fi from any phone (hotspot)

Settings > Wi-Fi also has a **Hotspot** button that works with any phone, an iPhone too, and needs no app. The tablet
starts a temporary Wi-Fi network and shows two QR codes. Scan the first with the phone's camera to join it; the phone then
opens a page by itself (or scan the second code) where you choose your Wi-Fi and type its password on the phone. The
kiosk joins it, and the tablet shows the new network. The hotspot replaces the kiosk's current Wi-Fi while it is up, ends by
itself after 10 minutes, and shows its own random password under the first code. How it works is in
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

Guests add songs through the Spotify app. This page sees queue changes when the track changes and, while the kiosk
plays, when Soloist says its queue changed, so a guest add can take a moment to show.

### Choosing music

The library button in the header opens **Choose music**: Liked Songs and your playlists, or the tracks played recently.
Tapping one starts it on this tablet (or on the speaker picked under Speakers); a recent track carries on with the album
or playlist it was played from. This needs the
`user-read-recently-played` and `playlist-read-private` scopes, so a login from before them has to sign in again in
Settings.

### Lyrics

Tap the artwork (the microphone button in its corner) to show the current song's lyrics in place of the artwork; tap the
picture button to bring the artwork back. The choice is remembered. Lyrics come from the kiosk service (`GET /lyrics`,
see [pi/kiosk-audio](pi/kiosk-audio/README.md)), which asks [LRCLIB](https://lrclib.net) (a free, open lyrics database),
Musixmatch, NetEase Cloud Music, QQ Music and KuGou; the app itself asks no lyrics site, so off the kiosk there are no
lyrics. All five can time each word, which lights the words up as they are sung: the service asks every one of them for
word-timed lyrics before it settles for line-timed ones, and for plain ones only when no source has synced lyrics.
Time-synced lyrics follow playback and keep the current line in the middle. Scrolling them pauses that, and they follow
the song again after 8 seconds of being left alone. Songs with only plain lyrics show them unsynced. Lookups happen only
while the lyrics are shown, once per track. Another source can be added as a `LyricsSource`
(`pi/kiosk-audio/lyrics-sources.ts`) in the `SOURCES` list in `pi/kiosk-audio/lyrics.ts`.

Spotify's own lyrics are not used: they come from an internal endpoint that is not part of the public Web API, needs
a signed-in web-player cookie (`sp_dc`) and a server to call it, and is against Spotify's terms.

### Debug console

On any tab, hold the clock in the top right for two seconds, tap Debug console on Settings > About, or press Ctrl+Shift+D with a keyboard to open the debug console.
It shows the app's state (version, connection, sign-in, playback mode, audio route, the kiosk player's device and the
active device) and a log of recent problems, kiosk player events and console errors,
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
`/srv/releases/the-max-mix/<commit>`, and then points `/srv/sites/the-max-mix` at it, which
[home-stack](https://github.com/nvorkinn/home-stack)'s Caddy serves as `https://the-max-mix.countdown.build` (its DNS
record is in countdown-server's `infra/cloudflare`). The same build goes into the release's Pi update bundle, and each kiosk
serves its own copy (pi/kiosk-audio, "The web app"). A merge to `main` does not change production.

Set it up once:

1. In Tailscale, let the workflow join the tailnet with its GitHub identity (the OAuth client and audience in
   `release.yml`, tagged `tag:ci`) and let `tag:ci` reach the server over SSH as `deploy`.
2. On the server, serve `/srv/sites/the-max-mix` with every unknown path answered by `/index.html`, a long-lived
   `Cache-Control` for `/assets/` and the response headers listed in [SECURITY.md](SECURITY.md). None of this is in
   the repository.
3. Push a tag to release: `git tag v1.2.3 && git push origin v1.2.3`.

The Raspberry Pi kiosk opens the deployed app (see [Raspberry Pi kiosk](#raspberry-pi-kiosk)), so
a release is also how a change reaches the kiosk.

## Local development

Use Node.js 24 LTS (the minimum).

```bash
npm ci
npm run dev
```

Open **<http://127.0.0.1:5173/>**; the dev server uses exactly that address and port (it stops rather than choosing another port).

To try the production build (the same files the Pi serves), run
`npm run build && npm start` and open
**<http://127.0.0.1:4173/>** (`vite preview`). `npm test` runs the app and kiosk service tests.

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
2. Register countdown-server's callback as the redirect URI, **exactly**:
   `https://app.countdown.build/spotify/sign-in/callback` and `https://app.countdown.run/spotify/sign-in/callback`.
3. The client ID is a constant in `src/spotify/settings.ts`; users never type it in. To use another Spotify app, change
   it there.
4. Choose **Connect Spotify** on the kiosk and scan the code with your phone. Spotify's sign-in opens on the phone; the
   kiosk signs in once the phone is back. The kiosk must be added to countdown-server first.
5. Tap the device indicator at the bottom left to open the speakers drawer, then select This tablet, an AirPlay speaker (kiosk only, several at once) or a Spotify Connect device. Press
   Play when ready. For a Connect device, first open Spotify on it so it is discoverable.

There is no client secret. Sign-in uses the Authorization Code flow with PKCE, which Spotify provides for apps that
cannot keep a secret: the kiosk creates a one-time code verifier for each sign-in and keeps it, and countdown-server
(`src/countdown/spotifySignIn.ts`) passes only its SHA-256 hash to the phone, which takes it to Spotify. Spotify sends
the phone back to countdown-server, which hands Spotify's code to the kiosk; the kiosk proves it holds the verifier
when it exchanges the code. countdown-server never sees the verifier or a token. The client ID is public by design, so
building it into the site is fine.

The refresh token is kept in the browser's `localStorage`, and the page calls the Spotify Web API directly. The
trade-offs:

- Clearing the site data signs you out; sign in again.
- Removing the last person in Settings drops the stored login and the cached access token. Spotify's own sign-in is on
  the phone, so the kiosk's browser never holds it.
- There is one login per browser profile.
- Anyone with access to the kiosk's browser profile has the Spotify login. See [SECURITY.md](SECURITY.md).

A login saved for a different client ID is ignored. Access tokens are short-lived and not stored.

Choose remote mode if the Pi should only control another player or if its
browser cannot stream Spotify audio. Remote mode follows the active device's real
playback state and controls, not the browser player's local state.

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

The kiosk is a Raspberry Pi 4 or 5 with the Waveshare 7-inch 1024x600 touch screen, running the app in Chromium under the
Cage kiosk compositor; with no connection, the app opens its Wi-Fi settings. Flash it with Raspberry Pi Imager from the
list at `https://github.com/nvorkinn/the-max-mix/releases/download/flash-image/the-max-mix.rpi-imager-manifest` and power
on.

**The whole OS is one image**, built from [`image/`](image/README.md): the packages, the files over the root file
system, the systemd units, the accounts, the boot settings, the web app and the kiosk-audio service. The root file system
is read-only and every update replaces it whole, so a file removed from `image/` is gone from every Pi after its next
update. Only what [`image/persist.list`](image/persist.list) names lives on `/data` and outlives updates, with the
Pi's own settings in `/data/the-max-mix/kiosk.env` ([image/README.md](image/README.md#the-pis-own-settings)). Change
`image/`, not the device.

- **A/B slots:** the card has two boot and two root partitions. [RAUC](https://rauc.io) installs an update into the
  slot the Pi is not running from, streaming the signed bundle (`the-max-mix.raucb`) from GitHub and downloading only
  the blocks that changed. The next boot tries the new slot once (the Pi firmware's `tryboot`); `kiosk-health` keeps it
  only when kiosk-audio, Cage and the app are up within 5 minutes, and otherwise the Pi boots its old slot again and
  never retries that version.
- **Channels:** `KIOSK_UPDATE_CHANNEL` in `kiosk.env` picks what a Pi follows. `stable` (the default) is the latest
  release; `dev` is every merge to `main`; `branch-<name>` is a branch built by hand (Actions > Image bundle > Run
  workflow) or a pull request with the `pi-bundle` label. `kiosk-update.timer` checks every 2 minutes (a stable Pi
  every 6 hours) with one request to the bundle's URL. A stable Pi restarts into an update at 04:30 or on **Restart**;
  dev and branch Pis restart straight away.
- **Releases** are what stable Pis follow. Create a release for a new tag on `main` with GitHub's **New release** form,
  or push a version tag from `main` (`git tag v1.12.0 && git push origin v1.12.0`): the Release workflow deploys the web
  app to the server, builds the bundle from the tag in parallel and, once both have worked, publishes the GitHub release
  with the bundle uploaded last. A Pi installs a release only once its bundle is there. That one tag ships both the web
  app and the Pi, and the version in the kiosk's Settings is the release's name.
- **The flash image** is promoted by hand: Actions > Flash image > Run workflow with a tag (or `dev`) puts that bundle's
  slots on a card image for Imager. A freshly flashed Pi updates itself to its channel's newest bundle, so it may lag.
- **Roll back:** run the Release workflow by hand with the earlier tag; it marks that release as the latest again with a
  bundle rebuilt from the tag, and the Pis install it as an ordinary update. On a Pi over SSH, `sudo kiosk-rollback`
  boots the other slot at once, since it still holds the previous version.
- **Check an update:** `journalctl -u kiosk-update -n 100`, `sudo rauc status`, and `sudo node
/opt/the-max-mix/kiosk-audio/kiosk-update.ts check` for what the channel has.

The kiosk opens the app with `?kiosk=1` (remembered across the Spotify sign-in redirect; `?kiosk=0` forgets it), which
adds kiosk-only entries to Settings: **Wi-Fi** (the networks in range, and joining one; it opens by itself when the kiosk starts with no network), the release the Pi runs and whether
a newer one is out, **Update now** (which opens the update console), **Restart kiosk**, **Reboot Pi**, **Screen sleep**, **Quiet hours** and, on a panel whose backlight the Pi can set (a DSI panel), **Brightness**. These go through the Pi's
[local service](pi/kiosk-audio/README.md).

Left alone with nothing playing, the kiosk switches to the Dashboard after a minute. Five minutes later it dims the
Dashboard: on a panel with a backlight the Pi can set it turns the backlight down to under a third of the **Brightness**
setting, and on any other (an HDMI screen has no brightness control) it puts a half-black layer over the page. After
the **Screen sleep** time on top of that it goes to sleep (**Never** leaves it dimmed). Once someone owns the kiosk,
the brightness, the screen sleep time and the quiet hours are kept on countdown-server with the rest of its settings. During **Quiet hours** (a start and end time, which may run past
midnight) the screen sleeps a minute after the last touch, on any tab. Music playing keeps the screen on and bright, in
quiet hours too, and music starting brings it back. The tap that brightens or wakes the screen presses nothing
behind it.

When the kiosk finds that a newer release is out (or, for a Pi pinned to a branch, a newer commit), a popup asks whether to
**Update now** or **Not now**; it asks once for each new version, and not while the screen sleeps or the speakers or debug dialog is open (it does show over Settings). The kiosk asks GitHub when it starts and again every time Settings opens, so
the answer shown there is fresh (an answer that cannot be had, offline or rate limited, keeps the last one found).
Updating, from the popup or from Settings, opens a full-screen update console. The app connects a WebSocket to the
kiosk service (`ws://127.0.0.1:7341/power/update`); connecting starts the update, and the service sends the journal of
the pull and then of the restart (`journalctl -u kiosk-pull`, `-u kiosk-restart`, with the journal's timestamps) as the
lines are written. The console has no way back while the update runs, because the kiosk restarts by itself when the
update needs it (which ends the connection); if nothing needed a restart, or the update failed, it can be closed.

While the screen sleeps the app asks Spotify about playback every 45 seconds instead of every 4 and stops reading the
queue, so an idle tablet does not use up the account's rate limit.

When Spotify answers a 429 with the reason `QUOTA_EXCEEDED` (the quota, which waiting does not lift), the app stops reading
Spotify by itself at once and does not start again until it is restarted (a reload, or Restart kiosk): no polling, and no
read when the page comes back to the front. A banner says so, and the buttons still work. **Poll Spotify for updates** in
Settings turns the timer off by choice: playback is then read when the page opens, after each button press and when the
page returns to the front, not every few seconds.

Spotify's browser API does not let the page read `Retry-After`, so after a 429 with no readable wait the app assumes one:
30 seconds, doubling with every 429 in a row up to 5 minutes. All polling and the controls hold off until it passes
(the banner says "Waiting for Spotify"), and each assumed wait is written to the debug console.

References: [Raspberry Pi kiosk guide](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/),
[Spotify redirect requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri),
[Spotify Soloist](https://developer.spotify.com/documentation/soloist).
