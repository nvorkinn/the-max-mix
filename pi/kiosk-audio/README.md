# THE MAX MIX kiosk service and audio routing

A small TypeScript service that runs on the Pi as a user unit (`kiosk-audio.service`, as the `kiosk` user) and answers the
app on `127.0.0.1:7341`. It does two jobs:

- **AirPlay.** It lists the AirPlay speakers PipeWire found, and sends the kiosk browser's sound to the ones picked in the
  app (Sonos and other AirPlay 2 speakers that also accept RAOP). It is what the app's **AirPlay** mode under Speakers
  drives.
- **The kiosk buttons.** Update now (which streams the update's journal to the app), Restart kiosk, Reboot Pi, the Wi-Fi
  panel and waking the screen.

## The two playback modes

- **Spotify Connect** (the default): Spotify plays on the tablet's Web Playback SDK player, or on any Spotify Connect
  speaker it is moved to under Speakers. Switching to it sends `POST /audio/route` with no speakers, which hands the sound back to the
  Pi's default output.
- **AirPlay**: playback stays on the tablet's own player, and the Pi links Chromium's PipeWire stream to every speaker
  picked in the app, all at once, and off the Pi's own output. Speakers can be added and removed while the music plays.

## The web app

The release's Pi bundle carries the built web app (`app/`), and the Ansible role installs each release in
`/opt/the-max-mix/app/releases/<commit>`. When the kiosk starts, `kiosk-app-switch` makes the newest one
`/opt/the-max-mix/app/current` and removes the others, so a page that is already open never loses a file to a newer
release. This service serves `current` (`KIOSK_APP_DIR`, `app-files.ts`) on `http://127.0.0.1:7341/`, which lets the
kiosk start the app with no internet: `index.html` and the top-level files are checked again on every load, and the
hashed files under `assets/` are kept for good. Every file goes out with `X-Content-Type-Options`, `Referrer-Policy`
and `X-Frame-Options`. A Pi following a branch serves the latest release's app, which `kiosk-pull` fetches for it.

When the app is this local copy, its own GETs are same-origin and Chromium sends no `Origin` with them, so the checks
that answer only the app also take `Sec-Fetch-Site: same-origin` (`isFromApp` in `server.ts`).

### Moving the saved data over

The browser keeps `localStorage` per origin, so the people, their Spotify logins and the countdown device secret that the
hosted app saved stay on its origin. While the kiosk still opens the hosted app, that app hands its `maxmix.*` items to
this service at every start and every ten minutes (`POST /handover`, the hosted origin only), which keeps them in
`~/.local/state/the-max-mix/handover.json` (readable by the kiosk user only, `handover.ts`). Once the kiosk opens the
local copy, that copy takes them on its first start (`GET /handover`, same-origin only), keeping any it already has, and
has the file deleted (`POST /handover/done`). See `src/utils/handover.ts`.

## Screen

`GET /screen` answers what the tablet's screen is, for registering with countdown-server (`screen.ts`):
`{"width": 1280, "height": 800, "brightness_control": false}`. The size is the first mode of the first connected
display connector in `/sys/class/drm`, the mode Cage runs at, so it holds for a DSI panel (no EDID) as for HDMI. A
screen the kiosk shows turned by 90 or 270 degrees (`KIOSK_SCREEN_ROTATION`) has its width and height the other way
round: 1920x1200 for a 1200x1920 panel.

How the kiosk shows the screen is worked out as it starts (`screen-setup.ts`, run as root by `kiosk.service`): a screen
in its `KNOWN_SCREENS` table gets its own rotation and scale (the 10.1 inch Raspberry Pi Touch Display 2: 90 degrees,
1.5), any other is shown as it is, and the role's `kiosk_screen_rotation` and `kiosk_screen_scale` win when set. It
writes `KIOSK_SCREEN_ROTATION` and `KIOSK_SCREEN_SCALE` to `/run/kiosk/screen.env`, which `kiosk.service` and this
service read, and the touch screen's rotation to `/run/udev/rules.d/90-kiosk-touch-rotation.rules`. So a fresh Pi with a
known screen registers with its landscape size from the first start, with no `kiosk-vars.yml`.
`brightness_control` is true when `/sys/class/backlight` has an entry: a DSI panel's driver makes one, HDMI never
does. 503 with no screen connected.

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
- `POST /sonos/move` (`room`, `from`, `to`, `name`): moves a song in the group's Sonos queue (`ReorderTracksInQueue`),
  from place `from` to place `to` among the songs `GET /sonos/now` lists as next (counted from 0). The song at `from`
  must still be called `name`, so a queue that moved on meanwhile is not reordered wrongly.
- `GET /sonos/events`: server-sent events while the app listens (`sonos-events.ts`). `{"kind": "groups"}` when rooms join
  or leave a group, `{"kind": "now"}` when what a group plays or its volume changes; the app then reads what changed
  with the GETs above. For this the Pi subscribes to the speakers' own events (UPnP): the household's grouping on one
  speaker, and play state and volume on each group's leading speaker, following new leaders as the grouping changes. The
  speakers send those events to a listener the sonos-ts library opens on the Pi's home network address, on
  `SONOS_LISTENER_PORT` (6329, `kiosk_sonos_events_port` in Ansible). The subscriptions end when the last app goes away.
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
pairing prompt shows. This was checked on the-max-mix-2 with `pi/tools/bt-probe.mts` before it was built.

`presence.ts` scans Bluetooth LE (an LE-only discovery filter on hci0) only while the app's person switcher is open
(`POST /bluetooth/presence`), for two minutes at most, and never with no phone saved. It counts a saved phone as here
while it is connected or was heard in the last two minutes; for the first 8 s of a watch a phone not heard yet is
"checking", not away. The debug section shows Here or Away for each, and the log notes each change.

## How it works

1. **Discovery.** `libpipewire-module-raop-discover` (enabled by `/etc/pipewire/pipewire.conf.d/50-kiosk-raop.conf`)
   finds RAOP speakers through Avahi and makes a PipeWire sink for each, with `raop.latency.ms = 500`
   (`kiosk_raop_latency_ms`) so play, pause and skip reach the speakers quickly. The audio service
   also answers `GET http://127.0.0.1:7341/speakers` (`server.ts`, localhost only, readable by the app's origin alone) with
   the names of those sinks and of connected Bluetooth speakers' sinks, and the app lists them every 5 seconds. Its
   `outputs` list gives each sink by PipeWire's node name (its `id`), its `kind` (`airplay` for `raop_sink.*`,
   `bluetooth` for `bluez_output.*`, the names PipeWire's own modules give them), a Bluetooth speaker's `address` (from
   the sink's `api.bluez5.address`, as in `GET /bluetooth/devices`), its volume, and `linked`: whether one of
   Chromium's streams is linked to it in PipeWire right now, which is where the sound really goes. Chromium's own device list is not used: it hides
   the names until a microphone is open, and the Pi has none.
2. **Routing.** Picking speakers sends `POST /audio/route` with `{"outputs": ["raop_sink.Kitchen.local.7000", …]}` (ids
   from `outputs`), or `{"speakers": ["Kitchen", "Lounge"]}` (the sinks' descriptions) from older apps. An id keeps two
   speakers with the same name apart; but an AirPlay sink's node name holds the speaker's address and port, so the
   service saves each id with its name, and routes by the name only while no sink has the id. The service saves the
   choice in `~/.local/state/the-max-mix/speakers.json` and links each of Chromium's
   channels to the same channel of every chosen sink with `pw-link`, before removing its links to other sinks, so the
   music does not drop out. Links to anything that is not a sink (a level meter) are left alone.
3. **Keeping it there.** The `kiosk-audio` user unit (`node kiosk-audio.ts watch`) reads the saved choice every 2
   seconds and routes again when needed, so a stream Chromium opens again, or a speaker that drops off the network and
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
`journalctl _SYSTEMD_USER_UNIT=kiosk-audio.service` (as root), lines starting `app` or `No heartbeat`.

## The requests

| Request                                | What it does                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /speakers`                        | `{"speakers": [...], "volumes": {"Kitchen": 40}}`                                    |
| `POST /audio/route`                    | Routes the sound to the speakers in the JSON body                                    |
| `POST /audio/volume`                   | Sets one speaker's volume (404: not on the network)                                  |
| `WS /power/update`                     | Connecting starts the update and streams it (below)                                  |
| `POST /power/restart`, `/power/reboot` | Restarts the kiosk; reboots                                                          |
| `POST /display/wake`                   | Turns the screen on (`kiosk-display on`)                                             |
| `POST /display/brightness`             | Sets the backlight to `{"percent": 1-100, "fade"?: true}` (404: the screen has none) |
| `POST /browser/forget-sign-ins`        | Clears every other site's cookies and storage in Chromium, over DevTools             |
| `POST /heartbeat`                      | The app is alive (the watchdog, below)                                               |
| `POST /log`                            | An app error, written to the journal                                                 |
| `GET /lyrics?title=&artist=&duration=` | Lyrics: `{"source"}` with `"lrc"`, `"plain"` or `"instrumental"` (404, 502)          |
| `GET /bluetooth/devices`               | `{"devices": [{"address", "name", "paired", "connected"}]}`                          |
| `POST /bluetooth/scan`                 | Looks for speakers for 8 seconds; the same answer                                    |
| `POST /bluetooth/connect`              | Pairs, trusts and connects `{"address"}`                                             |
| `POST /bluetooth/remove`               | Forgets `{"address"}`                                                                |
| `POST /wifi/phone`                     | Starts Wi-Fi setup from a phone over Bluetooth (5 minutes)                           |
| `POST /wifi/phone/stop`                | Stops it                                                                             |
| `GET /wifi/phone`                      | `{"state": "waiting" \| "joining" \| "joined" \| "idle", "error"?}`                  |
| `POST /wifi/hotspot`                   | Starts the setup hotspot: name, password, address, QR codes                          |
| `POST /wifi/hotspot/stop`              | Ends it and puts the earlier network back                                            |
| `GET /wifi/hotspot`                    | `{"state": "running" \| "connected" \| "joining" \| "joined" \| "failed" \| "idle"}` |
| `GET /wifi/status`                     | `{"ssid"}`: the network the Wi-Fi is on, or null (the app only)                      |
| `GET /wifi/networks`                   | The Wi-Fi networks in range, strongest first                                         |
| `POST /wifi/connect`                   | Joins one (`{"ssid", "password", "hidden", "security"}`)                             |

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

## Wi-Fi from a phone over Bluetooth

A **From phone** button on the tablet saves typing a long password there. It sends `POST /wifi/phone`, and `phone-setup.ts` makes the kiosk advertise [Improv Wi-Fi](https://www.improv-wifi.com/ble/) over
Bluetooth LE for 5 minutes (a tap on the button again gives another 5). `improv.ts` is the protocol (packets, checksum,
and a session that turns the phone's "send Wi-Fi settings" command into the same `Nmcli.connect` that `POST /wifi/connect` uses), and
`improv-gatt.ts` is the Bluetooth side: it exports a GATT service and an advertisement on the system bus with
`dbus-native` and registers them with BlueZ (`RegisterApplication`, `RegisterAdvertisement`; the first adapter, hci0).
When the phone has joined a network, advertising stops 4 seconds later. `GET /wifi/phone` says where it is (waiting,
with the reason when the phone's last network could not be joined; joining; then joined until the next start), which
the tablet's From phone dialog follows; Back there sends `POST /wifi/phone/stop`.

The button is the authorization Improv asks for: nothing advertises until someone taps it on the tablet, so a phone
that is only nearby cannot change the Wi-Fi. The password goes from the phone to the kiosk over an unencrypted
Bluetooth LE link, as Improv does, so the setup is only open for the minutes after the tap. The phone needs a page that
speaks Improv over Web Bluetooth, which Chrome on Android has and Safari on an iPhone does not.
[improv-wifi.com](https://www.improv-wifi.com) is one; it is somebody else's page, which sees the password.

`GET /lyrics` answers the app's origin only (each request makes the Pi call out), and is the app's only way to lyrics.
`lyrics.ts` asks LRCLIB (`lyrics-lrclib.ts`), Musixmatch (`lyrics-musixmatch.ts`) and NetEase, QQ Music and KuGou
(`lyrics-sources.ts`; these four have no public API for this and do not allow a web page to call them), and keeps only a
song whose title, artist and length match. Lyrics that time each word come first: all five are asked for those at once
(LRCLIB's Lyricsfile, Musixmatch's richsync, NetEase's YRC, QQ Music's QRC and KuGou's KRC, each turned into LRC with a
`<mm:ss.xxx>` tag before every word), and the first in that order that has them wins. Only when none has them are the
five asked in turn for line-timed lyrics (text with several timed lines), and after that for plain ones, which only
LRCLIB keeps. A song LRCLIB knows as instrumental and has no synced lyrics for is answered as instrumental. QRC comes
encrypted with QQ's own variant of Triple DES, which `qrc-cipher.ts` undoes. The service remembers the synced lyrics it
found, and for an hour anything less (plain lyrics, an instrumental song, nothing).

LRCLIB has a documented API (<https://lrclib.net/docs>): the service names itself in `User-Agent`, searches with the
search that sends no lyrics and then fetches the one record it wants, and after an error with `Retry-After` does not
call LRCLIB again until that time has passed. Musixmatch is called through the API its desktop app uses: the service
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
`words.ts`. The hotspot's page for a phone follows the phone's `Accept-Language`, with its words in `words.ts` too.

| File               | What it is                                                              |
| ------------------ | ----------------------------------------------------------------------- |
| `kiosk-audio.ts`   | The program: `watch`, the background unit that also starts the service. |
| `server.ts`        | The HTTP service: the requests above, and the origin checks.            |
| `update-socket.ts` | The WebSocket at `/power/update`: origin check, one update at a time.   |
| `update.ts`        | The update: follows the journal, runs the pull and the restart.         |
| `actions.ts`       | The fixed commands behind the power and screen requests.                |
| `nmcli.ts`         | Wi-Fi through nmcli: scanning, joining, and the messages for errors.    |
| `words.ts`         | The hotspot page's words and the service's messages, in two languages.  |
| `watchdog.ts`      | Restarts Chromium when the app's heartbeats stop.                       |
| `speakers.ts`      | Checking speaker lists, the saved choice, and routing to it.            |
| `pipewire.ts`      | `pw-dump` parsing, the link plan, `pw-link` and `wpctl set-volume`.     |

It is TypeScript that Node runs directly, so Ansible copies the `.ts` files as they are and nothing is built. Its one npm
package is `ws` (the WebSocket server): the playbook installs it on the Pi with `npm ci` from
`ansible/roles/kiosk/files/kiosk-audio/package-lock.json` (so only the reviewed version; Dependabot watches that lockfile). That needs Node 22.18 or later, so the role installs Node
`kiosk_nodejs_major` (24, as in `.nvmrc`) from NodeSource's archive, since Debian trixie has Node 20. Its signing key is
pinned by checksum and unattended upgrades cover it.

## The update stream

`WS /power/update` is a WebSocket on the same port. Connecting to it starts an update, and the service sends JSON text
frames: `{"type":"log","line":"…"}` for each line of the journal (`journalctl --output short-iso`, so each carries its
timestamp), `{"type":"error","line":"…"}` for journalctl's own complaints, and `{"type":"status","state":…}` with state
`pulling`, `restarting`, `done` or `failed` (and a `message`). It then closes the connection.

1. It starts `journalctl --unit kiosk-pull.service --follow` (from the second before, so nothing is missed), then
   `systemctl start kiosk-pull.service`, which returns when the pull is done, and stops the journalctl.
2. If the pull left the restart marker (`/run/kiosk/restart-needed`), the same for `kiosk-restart.service`. That restarts
   the browser the app runs in, so the connection most likely ends there; that is expected.
3. Every journalctl is stopped when its step ends, when the app goes away, after 35 minutes, and when the service stops
   (a failed pull stops everything). If the app goes away during the pull, the pull goes on by itself and the kiosk
   restarts at the usual quiet time. Only one update runs at a time.

It needs the `kiosk` user to read the journal (the `systemd-journal` group, `kiosk_groups`) and to start those two units
(`50-kiosk-power.rules`). The group applies when the user's session next starts, so the first update after a deploy may
show journalctl's "no permission" instead of the lines; the pull and restart still run.

## Security

- It listens on 127.0.0.1 only (`server.ts` binds there), apart from the Sonos events port (6329) that the sonos-ts
  library opens on the home network once the app follows the speakers. That port takes events only for the
  subscriptions the Pi holds (anything else gets 412), and otherwise answers just the library's `/status` and `/health`. It answers the app's origin alone
  (CORS), and refuses every POST and every WebSocket whose `Origin` header is not the app's (a browser does not apply CORS
  to a WebSocket), so no other web page can trigger an action.
- A request names a fixed action; it never carries a command. Routing accepts at most 16 speaker names of up to 256
  characters and can only link the browser's stream to existing sinks. Everything runs by absolute path with an argument
  list, no shell. `POST /sonos/play` takes a room name (one line, at most 64 characters, not starting with `-`) and a
  `spotify:<kind>:<22-character id>` URI, and hands them to the sonos-ts library, which runs no program. polkit (`50-kiosk-power.rules`) limits what the `kiosk` user may do with systemd and power.
- Everything runs as the `kiosk` user, next to that user's PipeWire.

## On the device

- `systemctl --user -M kiosk@ status kiosk-audio` and `journalctl _SYSTEMD_USER_UNIT=kiosk-audio.service` (as root).
- `wpctl status` lists the AirPlay sinks; `pw-link -l` shows where Chromium's stream goes; `wpctl get-volume <id>`
  shows a speaker's volume as the app does.
- `curl -s http://127.0.0.1:7341/speakers` lists what the app sees. A POST needs the app's `Origin`, for example
  `curl -X POST -H 'Origin: http://127.0.0.1:7341' http://127.0.0.1:7341/power/restart`.

## Tests

The Vitest suite (`npm test`) includes `pi/kiosk-audio/*.test.ts`, with `pw-dump` replies stubbed. It is type-checked
and linted with the repository's tooling rules (`tsconfig.node.json`).
