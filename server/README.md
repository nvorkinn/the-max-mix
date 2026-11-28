# THE MAX MIX kiosk server

A small TypeScript server that runs on the Pi as a user unit (`kiosk-server.service`, as the `kiosk` user) and answers
the app on `127.0.0.1:7341`. It does everything the app cannot do from a browser: it serves the app itself, routes the
sound, talks to Sonos, Bluetooth and Wi-Fi, fetches lyrics, watches that the app is alive and updates the Pi. Its code
is in `src/`, and the file names below are in that folder. Its first two jobs:

- **AirPlay.** It lists the AirPlay speakers PipeWire found, and sends the kiosk's music (Spotify Soloist's stream) to the ones picked in the
  app (Sonos and other AirPlay 2 speakers that also accept RAOP). It is what the app's **AirPlay** mode under Speakers
  drives.
- **The kiosk buttons.** Update now (which streams the update's journal to the app), Restart kiosk, Reboot Pi, the Wi-Fi
  panel and waking the screen.

## The two playback modes

- **Spotify Connect** (the default): Spotify plays on the kiosk's own player (Spotify Soloist), or on any Spotify Connect
  speaker it is moved to under Speakers. Switching to it sends `POST /audio/route` with no speakers, which sends Soloist's sound to the
  silent sink, `kiosk_silent`: the kiosk has no speaker of its own, so no speaker plays that nobody chose.
- **AirPlay**: playback stays on the kiosk's own player, and the Pi links Soloist's PipeWire stream to every speaker
  picked in the app, all at once, and off the Pi's own output. Speakers can be added and removed while the music plays.

## The web app

The built web app is part of the Pi's image, at `/opt/the-max-mix/app`. A new one comes with a reboot into a new slot,
or, when a release changed nothing else, onto `/data/the-max-mix/apps` with a restart of the kiosk and of this service
([Updates](#updates)). Either way this service keeps the folder it started with, so a page that is already open never
loses a file to a newer release. It serves it (`KIOSK_APP_DIR`, set by `app-node` to the app in use; `app-files.ts`) on `http://127.0.0.1:7341/`, which lets the kiosk start the app with no internet:
`index.html` and the top-level files are checked again on every load, and the hashed files under `assets/` are kept
for good. Every file goes out with `X-Content-Type-Options`, `Referrer-Policy` and `X-Frame-Options`. A dev or branch
Pi serves the app built from its own commit.

When the app is this local copy, its own GETs are same-origin and Chromium sends no `Origin` with them, so the checks
that answer only the app also take `Sec-Fetch-Site: same-origin` (`isFromApp` in `server.ts`).

### Moving the saved data over

The browser keeps `localStorage` per origin, so the people, their Spotify logins and the countdown device secret that the
hosted app saved stay on its origin. While the kiosk still opens the hosted app, that app hands its `maxmix.*` items to
this service at every start and every ten minutes (`POST /handover`, the hosted origin only), which keeps them in
`~/.local/state/the-max-mix/handover.json` (readable by the kiosk user only, `handover.ts`). Once the kiosk opens the
local copy, that copy takes them on its first start (`GET /handover`, same-origin only), keeping any it already has, and
has the file deleted (`POST /handover/done`). See `web/src/utils/handover.ts`.

## Screen

`GET /screen` answers what the tablet's screen is, for registering with countdown-server (`screen.ts`):
`{"width": 1280, "height": 800, "brightness_control": false}`. The size is the first mode of the first connected
display connector in `/sys/class/drm`, the mode Cage runs at, so it holds for a DSI panel (no EDID) as for HDMI. A
screen the kiosk shows turned by 90 or 270 degrees (`KIOSK_SCREEN_ROTATION`) has its width and height the other way
round: 1920x1200 for a 1200x1920 panel.

How the kiosk shows the screen is worked out as it starts (`screen-setup.ts`, run as root by `kiosk.service`): a screen
in its `KNOWN_SCREENS` table gets its own rotation and scale (the 10.1 inch Raspberry Pi Touch Display 2: 90 degrees,
1.5; the 10.1 inch Waveshare RPI-HMI-101D: 180 degrees, 1), any other is shown as it is, and `KIOSK_ROTATION` and `KIOSK_SCALE` in `kiosk.env` win when set. It
writes `KIOSK_SCREEN_ROTATION` and `KIOSK_SCREEN_SCALE` to `/run/kiosk/screen.env`, which `kiosk.service` and this
service read, and the touch screen's rotation to `/run/udev/rules.d/90-kiosk-touch-rotation.rules`. So a fresh Pi with a
known screen registers with its landscape size from the first start, with no settings.
`brightness_control` is true when `/sys/class/backlight` has an entry: a DSI panel's driver makes one, HDMI never
does. 503 with no screen connected.

The screen mode on the kernel command line (`video=HDMI-A-1:1280x800@60`, which sets the console's mode and the one an
HDMI screen with no EDID gets): the boot partition comes from the image, so `screen-setup.ts --cmdline=/boot/firmware/cmdline.txt` writes it at every kiosk start: `KIOSK_VIDEO_MODE`
from `/data/the-max-mix/kiosk.env` (`--video-mode`) if set, else the screen's own (`screen-mode.ts`), else the mode
already there, else 1024x600. It takes effect at the next boot, so an update writes it into the new slot's boot
partition too (`node screen-mode.ts --cmdline <file> [--mode <mode>]`).

## First boot and factory reset

`kiosk-first-boot.ts` runs as root on every boot, before `/data` is mounted
(`image/rootfs/etc/systemd/system/kiosk-first-boot.service`). It grows the data partition to the end of the card and
formats it when it holds no filesystem, then takes in what Raspberry Pi Imager's customisation wrote to the card's first
partition: the host name (`/data/identity/hostname`), the SSH keys (the `admin` account's, whatever account name was
typed), and the Wi-Fi as a NetworkManager profile (`/data/network/system-connections`). It then deletes Imager's
`user-data`, `network-config` and `meta-data` from the card, as they hold the Wi-Fi password. The tests read Imager's
files from `imager-fixtures/`. None of that is needed: a card flashed with no Imager settings names the Pi
`the-max-mix-<last 4 hex digits of its serial number>`, the app opens its Wi-Fi setup as it has no network, and the
first network it joins fetches the admin account's SSH keys from GitHub and Soloist at once
(`image/rootfs/etc/NetworkManager/dispatcher.d/50-kiosk-online`).

`sudo kiosk-reset` over SSH, or **Factory reset** in the debug console (`POST /power/reset`, which starts
`kiosk-reset.service`), logs out of Tailscale, marks `/data` and reboots. The next boot formats `/data`, keeping only
the Pi's name, `kiosk.env` and its own `config.txt` lines, so the Pi starts as a new kiosk with the Wi-Fi step and the
QR code.

`POST /display/brightness` sets that backlight (`backlight.ts`): `{"percent": 40}` is 40% of the panel's own full
brightness, and never off, which is `kiosk-display`'s. With `"fade": true` it gets there in steps over 1.5 s, and a
newer request stops the fade. The app uses it for its brightness setting and to fade an idle screen down; on a screen with no backlight it answers 404 and the app darkens its page instead. The kernel lets only root
write the backlight, so the role's udev rule (`90-kiosk-backlight.rules`) gives it to the `video` group.

## Sonos

Spotify will not move its playback to a Sonos speaker from this app (its Web API hides Sonos as a restricted device), so
tapping a Sonos room in the app's Speakers drawer sends `POST /sonos/play` with `{"room": "Kitchen", "uri":
"spotify:track:…", "next": ["spotify:track:…", …], "positionMs": 61000}` (the song on screen, Spotify's queue and how far into the song it was). The service talks to the speakers with the
[sonos-ts library](https://sonos-ts.svrooij.io) (`sonos-library.ts`): it finds a speaker on the home network (SSDP),
empties the room's group's Sonos queue (`RemoveAllTracksFromQueue`), adds the song to it (`AddUriToQueue`), with the songs in `next` (Spotify's queue, at most 50; or, with `"queueFrom": "Kitchen"` when the music moves from one Sonos to another, the songs that group still has to play) after it (`AddMultipleURIsToQueue`, 16 at a time), goes to it, seeks to `positionMs` and plays it, through the Spotify account linked in the Sonos app; no
Spotify credentials are needed on the Pi. A failure answers 502 with the reason, which the app shows.

The app reaches everything else about Sonos here too:

- `GET /sonos/groups`: the household's groups and their rooms, the leading room first, and how long finding them took
  (`ms`).
- `GET /sonos/now?room=`: what the room's group plays (song, position, whether it plays, and the next 20 songs in its Sonos queue, which the app shows as up next), its volume, and whether it
  can seek.
- `GET /sonos/art?room=`: the song's artwork, fetched from the speaker's own address only.
- `POST /sonos/control` (`play`, `pause`, `next`, `previous`, `seek` with `positionMs`), `POST /sonos/volume` (the whole
  group, 0 to 100), `POST /sonos/join` (`room` joins the group `to` is in) and `POST /sonos/leave`.
- `POST /sonos/stream` (`room`): the room's group plays the tablet's own sound, so the tablet stays Spotify's player and
  the rooms play along (`tablet-stream.ts`). The app routes Soloist's stream to the `kiosk_sonos` sink as well
  (`POST /audio/route` with that id), and the Pi serves what that sink plays as one endless FLAC stream (verbatim frames,
  `flac.ts`, about 1.4 Mbit/s) at `GET /tablet.flac` on `SONOS_STREAM_PORT` (6330) on the home network. Only the group's
  leading room fetches it; Sonos keeps the other rooms in time (about 1.5 s behind the tablet). While the tablet is
  paused the stream carries silence, so the speakers keep it open. `GET /sonos/stream` answers `{"rooms"}`: the rooms
  whose group plays it now.
- `POST /sonos/move` (`room`, `from`, `to`, `name`): moves a song in the group's Sonos queue (`ReorderTracksInQueue`),
  from place `from` to place `to` among the songs `GET /sonos/now` lists as next (counted from 0). The song at `from`
  must still be called `name`, so a queue that moved on meanwhile is not reordered wrongly.
- `GET /sonos/events`: server-sent events while the app listens (`sonos-events.ts`). `{"kind": "groups"}` when rooms join
  or leave a group, `{"kind": "now"}` when what a group plays or its volume changes; the app then reads what changed
  with the GETs above. For this the Pi subscribes to the speakers' own events (UPnP): the household's grouping on one
  speaker, and play state and volume on each group's leading speaker, following new leaders as the grouping changes. The
  speakers send those events to a listener the sonos-ts library opens on the Pi's home network address, on
  `SONOS_LISTENER_PORT` (6329). The subscriptions end when the last app goes away.
  The app keeps a slow read (once a minute) as a fallback, and reads as before when the stream is not there.

## Bluetooth monitor

`GET /bluetooth/monitor` feeds the Bluetooth section of the app's debug console (hold the clock 2 s): the Pi's adapter,
the devices paired with it, when each was last heard and its signal strength, how many unpaired devices were heard in the
last minute, and a log of what BlueZ reported (`bluetooth-monitor.ts`). It watches BlueZ's objects on the system bus with
dbus-native, from the first time the app asks, and only listens: it never scans, pairs or advertises by itself (the
section's Scan button uses `POST /bluetooth/scan`). Unpaired devices are logged only after `POST /bluetooth/monitor`
with `{"verbose": true}`. It is the first step towards recognising people's phones; the log stays in memory.

**Pairing a phone** (the app's pairing sheet, or **Pair my phone** in the same section; `POST /bluetooth/pair-phone`,
`phone-pairing.ts`) makes the kiosk look for phones for two minutes, over Classic Bluetooth and LE together
(`phone-discovery.ts`). With Settings > Bluetooth open, an iPhone is discoverable over Classic under its fixed public
address and its own name, so the kiosk lists the named devices it hears (`bluetooth-monitor.ts`, phones first). Tapping
one (`POST /bluetooth/pair-phone/pick`) stops the scan and asks BlueZ to pair; the phone shows a code to confirm, the
kiosk shows the same code, and an agent says yes on the kiosk's side. The kiosk then notes the phone in
`~/.local/state/the-max-mix/phones.json` under that address and the name it was picked by, and disconnects it. The name
is never updated from BlueZ afterwards: BlueZ renames a device from any advert carrying a name, and an app on a phone can
advertise as anything. The Classic pairing also gives BlueZ the phone's LE identity key, which lets it recognise the
phone's changing LE addresses later. **Forget** on a device row (`POST /bluetooth/remove`) unpairs it and drops it from
`phones.json`, so a phone can pair again. The adapter's Alias is THE MAX MIX (set at start-up), which is what the phone's
pairing prompt shows. This was checked on the-max-mix-2 with `scripts/pi/bt-probe.mts` before it was built.

`presence.ts` scans Bluetooth LE (an LE-only discovery filter on hci0) only while the app's person switcher is open
(`POST /bluetooth/presence`), for two minutes at most, and never with no phone saved. It counts a saved phone as here
while it is connected or was heard in the last two minutes; for the first 8 s of a watch a phone not heard yet is
"checking", not away. The debug section shows Here or Away for each, and the log notes each change.

## How it works

1. **Discovery.** `libpipewire-module-raop-discover` (enabled by `/etc/pipewire/pipewire.conf.d/50-kiosk-raop.conf`)
   finds RAOP speakers through Avahi and makes a PipeWire sink for each, with `raop.latency.ms = 500`
   (`kiosk_raop_latency_ms`) so play, pause and skip reach the speakers quickly. The same file makes `kiosk_silent`, a
   null sink with a high session priority, so it is the default sink and Soloist's stream joins it at start without
   making a sound; it is not listed as a speaker. The server
   also answers `GET http://127.0.0.1:7341/speakers` (`server.ts`, localhost only, readable by the app's origin alone) with
   the names of those sinks and of connected Bluetooth speakers' sinks, and the app lists them every 5 seconds. Its
   `outputs` list gives each sink by PipeWire's node name (its `id`), its `kind` (`airplay` for `raop_sink.*`,
   `bluetooth` for `bluez_output.*`, the names PipeWire's own modules give them), a Bluetooth speaker's `address` (from
   the sink's `api.bluez5.address`, as in `GET /bluetooth/devices`), its volume, and `linked`: whether one of
   Soloist's streams is linked to it in PipeWire right now, which is where the sound really goes. Chromium's own device list is not used: it hides
   the names until a microphone is open, and the Pi has none.
2. **Routing.** Picking speakers sends `POST /audio/route` with `{"outputs": ["raop_sink.Kitchen.local.7000", …]}` (ids
   from `outputs`), or `{"speakers": ["Kitchen", "Lounge"]}` (the sinks' descriptions) from older apps. An id keeps two
   speakers with the same name apart; but an AirPlay sink's node name holds the speaker's address and port, so the
   service saves each id with its name, and routes by the name only while no sink has the id. The service saves the
   choice in `~/.local/state/the-max-mix/speakers.json` and links each of Soloist's
   channels to the same channel of every chosen sink with `pw-link`, before removing its links to other sinks, so the
   music does not drop out. Links to anything that is not a sink (a level meter) are left alone.
3. **Keeping it there.** The `kiosk-server` user unit (`node kiosk-server.ts watch`) reads the saved choice every 2
   seconds and routes again when needed, so a stream Soloist opens again, or a speaker that drops off the network and
   comes back, plays in the right place. If none of the chosen speakers is on the network, nothing changes.

4. **Volume.** `GET /speakers` also gives each speaker's volume, and the drawer shows a slider under each chosen
   speaker. Moving it sends `POST /audio/volume` with `{"output": "raop_sink.Kitchen.local.7000", "volume": 40}`
   (percent; `{"speaker": "Kitchen", …}` from older apps), and the
   service runs `wpctl set-volume <sink> 0.40`. The AirPlay sink passes the volume on to the speaker itself, so it is the
   same volume the speaker's own app shows. Both use wpctl's cubic scale (the cube root of PipeWire's channel volumes),
   like any volume slider.

The app still remembers its own choice (`maxmix.airplaySpeakers` in its storage); `linked` in `GET /speakers` is what
the Pi confirms.

## The watchdog

With `?kiosk=1` the app sends `POST /heartbeat` every 20 seconds while it shows something. When none has come for 3
minutes (a crashed tab, a hung page, or an app that went blank), the service stops Chromium and kiosk-session starts it
again. It only acts after this service has had a heartbeat, and gives every new Chromium the full 3 minutes; each restart without a heartbeat in between
doubles the wait (up to an hour), so a page that cannot load is not restarted in a loop. The app also sends its errors
to `POST /log` (at most 30 lines a minute reach the journal). Both are in the journal:
`journalctl _SYSTEMD_USER_UNIT=kiosk-server.service` (as root), lines starting `app` or `No heartbeat`.

## The requests

| Request                                | What it does                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /speakers`                        | `{"speakers": [...], "volumes": {"Kitchen": 40}}`                                     |
| `POST /audio/route`                    | Routes the sound to the speakers in the JSON body                                     |
| `POST /audio/volume`                   | Sets one speaker's volume (404: not on the network)                                   |
| `WS /power/update`                     | Connecting starts the update and streams it (below)                                   |
| `POST /power/restart`, `/power/reboot` | Restarts the kiosk; reboots                                                           |
| `POST /display/wake`                   | Turns the screen on (`kiosk-display on`)                                              |
| `POST /display/brightness`             | Sets the backlight to `{"percent": 1-100, "fade"?: true}` (404: the screen has none)  |
| `POST /heartbeat`                      | The app is alive (the watchdog, below)                                                |
| `POST /log`                            | An app error, written to the journal                                                  |
| `GET /lyrics?title=&artist=&duration=` | Lyrics: `{"source"}` with `"lrc"`, `"plain"` or `"instrumental"` (404, 502)           |
| `GET /bluetooth/devices`               | `{"devices": [{"address", "name", "paired", "connected"}]}`                           |
| `POST /bluetooth/scan`                 | Looks for speakers for 8 seconds; the same answer                                     |
| `POST /bluetooth/connect`              | Pairs, trusts and connects `{"address"}`                                              |
| `POST /bluetooth/remove`               | Forgets `{"address"}`                                                                 |
| `POST /wifi/hotspot`                   | Starts the setup hotspot: name, password, address, QR codes                           |
| `POST /wifi/hotspot/stop`              | Ends it and puts the earlier network back                                             |
| `GET /wifi/hotspot`                    | `{"state": "running" \| "connected" \| "joining" \| "joined" \| "failed" \| "idle"}`  |
| `GET /camera`                          | `{"available": true}`: whether the screen has a camera (the app's origin only)        |
| `GET /camera/stream`                   | The camera's picture as JPEG frames while the request is open (the app's origin only) |
| `GET /wifi/status`                     | `{"ssid"}`: the network the Wi-Fi is on, or null (the app only)                       |
| `GET /wifi/networks`                   | The Wi-Fi networks in range, strongest first                                          |
| `POST /wifi/connect`                   | Joins one (`{"ssid", "password", "hidden", "security"}`)                              |

## Bluetooth speakers

`bluetooth.ts` drives BlueZ's `bluetoothctl` (an argument list, never a shell; an address is checked first) to find,
pair, connect and forget Bluetooth speakers, one job at a time. The `kiosk` user is in the `bluetooth` group, which is
what BlueZ's D-Bus policy needs. Once a speaker is connected, PipeWire (`libspa-0.2-bluetooth`) makes an output named
`bluez_output.…` for it, and `speakers.ts` lists it with the AirPlay (`raop_sink.…`) ones, so choosing it, routing the
sound to it and its volume slider work as they do for AirPlay. Bluetooth plays to one speaker at a time, a little
behind the screen. A speaker is trusted when it is connected, so it reconnects by itself when it is switched on again.
The `/bluetooth/*` requests answer the app's origin only. The app's Speakers drawer has the Bluetooth section (Find
speakers, Pair or Connect, Forget).

## Wi-Fi from any phone (the hotspot)

`POST /wifi/hotspot` (a **Hotspot** button on the tablet) works with any phone, with no app (the Bluetooth route below
needs Chrome on Android). `hotspot.ts` scans the networks in range, then asks NetworkManager for a hotspot (`nmcli device wifi hotspot`:
the name `THE MAX MIX setup`, a random 10-character password, 2.4 GHz). NetworkManager runs the DHCP and DNS for it
(`dnsmasq-base`), and `50-kiosk-captive.conf` makes that DNS answer every name with the kiosk's address, so the phone's
check for internet ends at the kiosk and its _sign in to Wi-Fi_ screen opens the hotspot's page by itself. The tablet shows
two QR codes (`qr.ts`, made on the Pi with `qrcode-generator`, loaded only when needed): one the phone's camera joins the
hotspot with, and one that opens the page, for a phone that does not open it by itself. The page (`hotspot-portal.ts`)
lists the networks scanned before the hotspot took the radio and asks for the password on the phone's own keyboard.

It is the service's own HTTP server that answers the phone: while the hotspot is up it also accepts connections on the
hotspot's address, on port 80 (`50-kiosk-unprivileged-ports.conf` lets the service use it; without that, port 8080, and
only the second QR code reaches it). Whatever arrives that way, and not on `127.0.0.1`, is given to the hotspot page's
handler and to nothing else, whatever its `Origin` says, and the update WebSocket refuses it too, so nobody on the
hotspot can reboot the kiosk or start an update.

The Pi has one Wi-Fi radio, so the hotspot replaces the network it was on. When the phone has chosen a network, the
kiosk answers it, leaves the hotspot, and joins; `GET /wifi/hotspot` then says `joined`, which the tablet's Hotspot
dialog waits for. When it fails,
`GET /wifi/hotspot` says why and the earlier network comes back, and the hotspot can be started again. The hotspot also ends by itself after 10
minutes. The hotspot's own password is shown on the tablet, and is only a barrier for those who can see the screen.

`GET /lyrics` answers the app's origin only (each request makes the Pi call out), and is the app's only way to lyrics.
`lyrics.ts` asks LRCLIB (`lyrics-lrclib.ts`), Musixmatch (`lyrics-musixmatch.ts`) and NetEase, QQ Music and KuGou
(`lyrics-sources.ts`; these four have no public API for this and do not allow a web page to call them), and keeps only a
song whose title, artist and length match. Lyrics that time each word come first: all five are asked for those at once
(LRCLIB's Lyricsfile, Musixmatch's richsync, NetEase's YRC, QQ Music's QRC and KuGou's KRC, each turned into LRC with a
`<mm:ss.xxx>` tag before every word), and the first in that order that has them wins. Only when none has them are the
five asked in turn for line-timed lyrics (text with several timed lines), and after that for plain ones, which only
LRCLIB keeps. A song LRCLIB knows as instrumental and has no synced lyrics for is answered as instrumental. QRC comes
encrypted with QQ's own variant of Triple DES, which `qrc-cipher.ts` undoes. The service remembers the synced lyrics it
found, and for an hour anything less (plain lyrics, an instrumental song, nothing). A song it does not remember is only
looked up after a pause of 1.5 s, and the lookup stops asking the sources once the app hangs up (the app cancels the
request when it moves on to the next song), so songs skipped in a row cost (almost) no requests.

LRCLIB has a documented API (<https://lrclib.net/docs>): the service names itself in `User-Agent`, searches with the
search that sends no lyrics and then fetches the one record it wants, one request at a time. After a 429, or an error
with `Retry-After`, it does not call LRCLIB again until that time has passed (a minute for a 429 that does not say),
logging that once rather than for each lookup it fails meanwhile. Musixmatch is called through the API its desktop app uses: the service
asks it for a user token (`token.get`) and keeps it until Musixmatch stops taking it; when Musixmatch hands out a token
of only zeros (it does for addresses it will not serve, such as cloud servers), the source is skipped for five minutes.
KuGou's search host is called over plain http because its https certificate is for another domain. QQ Music's search
answers with nothing for a few minutes after several searches in a row. The endpoints of those four are unofficial and
can change: a source that breaks is skipped, so remove it from `SOURCES` if it keeps failing.

The Wi-Fi requests are for the app's Settings > Wi-Fi, which lists the networks in range and joins one, and which opens
by itself when the kiosk starts with no network. The app works offline because this service serves it (its origin is
then `http://127.0.0.1:7341`), and the Wi-Fi POSTs answer the app's origin only. They use nmcli (`nmcli.ts`): the
password reaches nmcli on stdin, never in argv or the journal, and a failed attempt deletes the profile it made and
brings back the Wi-Fi that was on. Joining a network restarts nothing: the app stays up and sees the new network.

The service's own error messages stay in English in the code; the app shows them in its language with `localize` from
`shared/src/words.ts`. The hotspot's page for a phone follows the phone's `Accept-Language`, with its words in that
file too. `shared/` holds what the server and the app both import; it is packed beside the server on the Pi.

| File               | What it is                                                              |
| ------------------ | ----------------------------------------------------------------------- |
| `kiosk-server.ts`  | The program: `watch`, the background unit that also starts the service. |
| `server.ts`        | The HTTP service: the requests above, and the origin checks.            |
| `update-socket.ts` | The WebSocket at `/power/update`: origin check, one update at a time.   |
| `update.ts`        | The update: follows the journal, runs the pull and the restart.         |
| `actions.ts`       | The fixed commands behind the power and screen requests.                |
| `nmcli.ts`         | Wi-Fi through nmcli: scanning, joining, locating, the error messages.   |
| `watchdog.ts`      | Restarts Chromium when the app's heartbeats stop.                       |
| `speakers.ts`      | Checking speaker lists, the saved choice, and routing to it.            |
| `pipewire.ts`      | `pw-dump` parsing, the link plan, `pw-link` and `wpctl set-volume`.     |

It is TypeScript that Node runs directly, so the image build copies the `.ts` files as they are and nothing is built.
Its npm packages are installed with `npm ci` from `server/package-lock.json` (so only the reviewed versions;
Dependabot watches that lockfile). That needs Node 22.18 or later, so the image has Node 24 (as in `.nvmrc`) from
NodeSource's archive, since Debian trixie has Node 20.

## The update stream

`WS /power/update` is a WebSocket on the same port. Connecting to it starts an update, and the service sends JSON text
frames: `{"type":"log","line":"…"}` for each line of the journal (`journalctl --output short-iso`, so each carries its
timestamp), `{"type":"error","line":"…"}` for journalctl's own complaints, and `{"type":"status","state":…}` with state
`installing`, `installed` (with the version), `restarting`, `done` or `failed` (and a `message`). It then closes
the connection.

It starts `journalctl --unit kiosk-update.service --follow` (from the second before, so nothing is missed), then
`systemctl start kiosk-update.service`, which returns when the check and any install are done. On a dev or branch Pi the
unit reboots into the update straight away, which ends the connection; that is expected. The journalctl is stopped when
the unit ends, when the app goes away, after 35 minutes, and when the service stops. If the app goes away, the update
goes on by itself. Only one update runs at a time.

It needs the `kiosk` user to read the journal (the `systemd-journal` group) and to start the unit
(`50-kiosk-power.rules`).

## Updates

Every Pi updates as a whole: the OS, this service and the web app
are one signed RAUC bundle on GitHub, installed into the slot the Pi does not run from. `image-update.ts` holds the one
code path the timer, the screen and `kiosk-rollback` share:

- **Channels.** `KIOSK_UPDATE_CHANNEL` in `/data/the-max-mix/kiosk.env`: `stable` (the default; the latest release,
  checked every 6 hours), `dev` (the rolling `dev` pre-release, checked every 2 minutes) or `branch-<name>` (that
  pre-release, also every 2 minutes). Each release has `bundle.txt`, which names its bundle: each build's has a name of
  its own (`the-max-mix-<tag or commit>.raucb`) and is never replaced, so a Pi in the middle of an install keeps
  streaming the file it started on.
- **Check.** It reads `bundle.txt` (not the rate-limited API); only when that names another bundle is its manifest read
  (RAUC's `InspectBundle`, a few range requests). Its version (`<ref>+<commit>`) is compared with the running one
  (`/usr/lib/the-max-mix/release.env`), the one waiting for a restart and the ones that failed here.
- **Install.** `kiosk-update.service` (root) runs `rauc install` over D-Bus, streaming from the URL, and logs
  `Update progress: N% …` lines. `WS /power/update` starts that unit and streams its journal (above), and ends with
  `installed` (with the version) or `done`. `POST /update/check` answers what the channel has.
- **Apply.** At 04:30 and on Restart (`kiosk-restart.service`) the Pi reboots with `tryboot` into the new slot, once.
  Dev and branch Pis do that straight after the install.
- **Health.** `kiosk-health.service` gives each boot 5 minutes: this service answers, Cage and Chromium run and the app
  sends heartbeats (`GET /health`). Then `rauc status mark-good`, which makes a new slot the one every boot starts
  (`boot-slots.ts` rewrites `autoboot.txt`). A new slot that fails, hangs (hardware watchdog) or panics ends up back on
  the old slot, and its version is never installed again.
- **Rollback.** `sudo kiosk-rollback` tries the other slot (the previous version) at once and keeps it once healthy.
- **Only the app changed.** Most releases change just the web app and this service, 26 MB of a 4 GB slot. Each bundle
  has that app beside it (`….app.tar.gz`), with a manifest (`….app.json`: version, `KIOSK_RELEASE_OS`, size, SHA-256)
  signed with the bundle's key (`….app.json.sig`). When the manifest is signed and names the running slot's
  `KIOSK_RELEASE_OS`, Install only downloads and unpacks the app into `/data/the-max-mix/apps/<version>`
  (`app-store.ts`) and runs its `kiosk-update.ts check` once. Apply then points `/run/the-max-mix/app` at it and
  restarts this service and the kiosk, with no reboot, and runs the same health check at once: healthy, the app stays
  and the one before it is kept for a rollback; not healthy, the Pi changes back and never installs that version
  again. Anything else (another OS, no manifest, a bad signature) takes the whole bundle. An app on `/data` counts
  only over the slot release it was installed on (`over`), so a new slot starts with its own app; the image's
  `app-select` decides that at each boot. `kiosk-rollback` goes back to the app before, or to the image's own.
  On a Pi 5 the download, unpack and change-over took 4 seconds and the kiosk was back about 5 seconds later; the whole
  bundle took 3 minutes 39 seconds and a reboot.

State lives in `/data/the-max-mix/update/state.json`; `sudo kiosk-update check` prints what the channel has.

## Security

- It listens on 127.0.0.1 only (`server.ts` binds there), apart from the Sonos events port (6329) that the sonos-ts
  library opens on the home network once the app follows the speakers, and the tablet's stream (6330), which answers
  `GET /tablet.flac` alone (404 otherwise) and sends only what the `kiosk_sonos` sink plays. That port takes events only for the
  subscriptions the Pi holds (anything else gets 412), and otherwise answers just the library's `/status` and `/health`. It answers the app's origin alone
  (CORS), and refuses every POST and every WebSocket whose `Origin` header is not the app's (a browser does not apply CORS
  to a WebSocket), so no other web page can trigger an action.
- A request names a fixed action; it never carries a command. Routing accepts at most 16 speaker names of up to 256
  characters and can only link Soloist's stream to existing sinks. Everything runs by absolute path with an argument
  list, no shell. `POST /sonos/play` takes a room name (one line, at most 64 characters, not starting with `-`) and a
  `spotify:<kind>:<22-character id>` URI, and hands them to the sonos-ts library, which runs no program. polkit (`50-kiosk-power.rules`) limits what the `kiosk` user may do with systemd and power.
- Everything runs as the `kiosk` user, next to that user's PipeWire.

## On the device

- `systemctl --user -M kiosk@ status kiosk-server` and `journalctl _SYSTEMD_USER_UNIT=kiosk-server.service` (as root).
- `wpctl status` lists the AirPlay sinks; `pw-link -l` shows where Soloist's stream goes; `wpctl get-volume <id>`
  shows a speaker's volume as the app does.
- `curl -s http://127.0.0.1:7341/speakers` lists what the app sees. A POST needs the app's `Origin`, for example
  `curl -X POST -H 'Origin: http://127.0.0.1:7341' http://127.0.0.1:7341/power/restart`.

## Tests

The Vitest suite (`npm test`) includes `server/src/*.test.ts`, with `pw-dump` replies stubbed. It is type-checked
and linted with the repository's tooling rules (`tsconfig.node.json`).
