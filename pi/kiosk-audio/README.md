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

**Pair my phone** in the same section (`POST /bluetooth/pair-phone`, `phone-pairing.ts`) makes the kiosk show up on
phones as a keyboard called THE MAX MIX for two minutes (`pairing-gatt.ts`): an iPhone lists it under Settings >
Bluetooth, and its values can only be read over an encrypted link, so tapping it makes the phone pair. An agent says yes
to that pairing (Just Works) while the window is open. The first device that pairs is taken as the phone: the kiosk stops
advertising, disconnects it, and notes it in `~/.local/state/the-max-mix/phones.json`. BlueZ keeps the phone's identity
key, which lets it recognise the phone's changing addresses later. No key presses are ever sent.

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
again, or shows the Wi-Fi setup page when there is no connection. The setup page sends heartbeats too. It only acts
after this service has had a heartbeat, and gives every new Chromium the full 3 minutes; each restart without a heartbeat in between
doubles the wait (up to an hour), so a page that cannot load is not restarted in a loop. The app also sends its errors
to `POST /log` (at most 30 lines a minute reach the journal). Both are in the journal:
`journalctl _SYSTEMD_USER_UNIT=kiosk-audio.service` (as root), lines starting `app` or `No heartbeat`.

## The requests

| Request                                | What it does                                                             |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `GET /speakers`                        | `{"speakers": [...], "volumes": {"Kitchen": 40}}`                        |
| `POST /audio/route`                    | Routes the sound to the speakers in the JSON body                        |
| `POST /audio/volume`                   | Sets one speaker's volume (404: not on the network)                      |
| `WS /power/update`                     | Connecting starts the update and streams it (below)                      |
| `POST /power/restart`, `/power/reboot` | Restarts the kiosk; reboots                                              |
| `POST /display/wake`                   | Turns the screen on (`kiosk-display on`)                                 |
| `POST /wifi`                           | Shows the Wi-Fi setup page (flag file, then stops Chromium)              |
| `POST /heartbeat`                      | The app is alive (the watchdog, below)                                   |
| `POST /log`                            | An app error, written to the journal                                     |
| `GET /lyrics?title=&artist=&duration=` | Synced lyrics as LRC: `{"source", "lrc"}` (404: none; 502: sources down) |
| `GET /bluetooth/devices`               | `{"devices": [{"address", "name", "paired", "connected"}]}`              |
| `POST /bluetooth/scan`                 | Looks for speakers for 8 seconds; the same answer                        |
| `POST /bluetooth/connect`              | Pairs, trusts and connects `{"address"}`                                 |
| `POST /bluetooth/remove`               | Forgets `{"address"}`                                                    |
| `POST /wifi/phone`                     | Starts Wi-Fi setup from a phone over Bluetooth (5 minutes)               |
| `POST /wifi/hotspot`                   | Starts the setup hotspot: name, password, address, QR codes              |
| `POST /wifi/hotspot/stop`              | Ends it and puts the earlier network back                                |
| `GET /wifi/hotspot`                    | `{"state": "running" \| "joining" \| "failed" \| "idle"}`                |
| `GET /wifi/status`                     | `{"ssid"}`: the network the Wi-Fi is on, or null (the app only)          |
| `GET /wifi/networks`                   | The Wi-Fi networks in range, strongest first                             |
| `POST /wifi/connect`                   | Joins one (`{"ssid", "password", "hidden", "security"}`)                 |
| `POST /wifi/done`                      | The setup page is finished: stops the Chromium showing it                |
| `GET /wifi-setup`                      | The Wi-Fi setup page, and its scripts under `/wifi-setup/`               |

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

The Wi-Fi setup page's **Hotspot** button works with any phone, with no app (the Bluetooth route below needs Chrome on
Android). `hotspot.ts` scans the networks in range, then asks NetworkManager for a hotspot (`nmcli device wifi hotspot`:
the name `THE MAX MIX setup`, a random 10-character password, 2.4 GHz). NetworkManager runs the DHCP and DNS for it
(`dnsmasq-base`), and `50-kiosk-captive.conf` makes that DNS answer every name with the kiosk's address, so the phone's
check for internet ends at the kiosk and its _sign in to Wi-Fi_ screen opens the setup page by itself. The tablet shows
two QR codes (`qr.ts`, made on the Pi with `qrcode-generator`, loaded only when needed): one the phone's camera joins the
hotspot with, and one that opens the page, for a phone that does not open it by itself. The page (`hotspot-portal.ts`)
lists the networks scanned before the hotspot took the radio and asks for the password on the phone's own keyboard.

It is the service's own HTTP server that answers the phone: while the hotspot is up it also accepts connections on the
hotspot's address, on port 80 (`50-kiosk-unprivileged-ports.conf` lets the service use it; without that, port 8080, and
only the second QR code reaches it). Whatever arrives that way, and not on `127.0.0.1`, is given to the setup page's
handler and to nothing else, whatever its `Origin` says, and the update WebSocket refuses it too, so nobody on the
hotspot can reboot the kiosk or start an update.

The Pi has one Wi-Fi radio, so the hotspot replaces the network it was on. When the phone has chosen a network, the
kiosk answers it, leaves the hotspot, and joins; the tablet's page closes when that works. When it fails, the tablet says
why and the earlier network comes back, and the hotspot can be started again. The hotspot also ends by itself after 10
minutes. The hotspot's own password is shown on the tablet, and is only a barrier for those who can see the screen.

## Wi-Fi from a phone over Bluetooth

The Wi-Fi setup page has a **From phone** button, so nobody has to type a long password on the tablet. It sends
`POST /wifi/phone`, and `phone-setup.ts` makes the kiosk advertise [Improv Wi-Fi](https://www.improv-wifi.com/ble/) over
Bluetooth LE for 5 minutes (a tap on the button again gives another 5). `improv.ts` is the protocol (packets, checksum,
and a session that turns the phone's "send Wi-Fi settings" command into the same `Nmcli.connect` the page uses), and
`improv-gatt.ts` is the Bluetooth side: it exports a GATT service and an advertisement on the system bus with
`dbus-native` and registers them with BlueZ (`RegisterApplication`, `RegisterAdvertisement`; the first adapter, hci0).
When the phone has joined a network, the page closes itself 4 seconds later, as it does after a join on the tablet.

The button is the authorization Improv asks for: nothing advertises until someone taps it on the tablet, so a phone
that is only nearby cannot change the Wi-Fi. The password goes from the phone to the kiosk over an unencrypted
Bluetooth LE link, as Improv does, so the setup is only open for the minutes after the tap. The phone needs a page that
speaks Improv over Web Bluetooth, which Chrome on Android has and Safari on an iPhone does not.
[improv-wifi.com](https://www.improv-wifi.com) is one; it is somebody else's page, which sees the password.

`GET /lyrics` answers the app's origin only (each request makes the Pi call out). `lyrics.ts` asks NetEase, QQ Music and
KuGou in turn (`lyrics-sources.ts`: none has a public API or allows a web page to call it, which is why this service
does), keeps only a song whose title, artist and length match, and accepts only text with several timed lines. It
remembers what it found, and for an hour what it did not. KuGou's search host is called over plain http because its
https certificate is for another domain. These are unofficial endpoints and can change: a source that breaks is
skipped, so remove it from `SOURCES` if it keeps failing.

The Wi-Fi requests are for the Wi-Fi setup page (`wifi-page.ts`, served by `wifi-setup.ts`), which kiosk-session shows
in Chromium when the Pi is offline or the app's Wi-Fi button was tapped. That page has to work offline, so this service serves it, and the Wi-Fi POSTs answer
only that page's own origin (`http://127.0.0.1:7341`), not the app's. Node strips the page script's types when it is
first asked for, and the page uses the sign-in keyboard (`pi/kiosk-keyboard`) for the password. They use nmcli (`nmcli.ts`): the password reaches nmcli on stdin,
never in argv or the journal, and a failed attempt deletes the profile it made and brings back the Wi-Fi that was on.

| File               | What it is                                                              |
| ------------------ | ----------------------------------------------------------------------- |
| `kiosk-audio.ts`   | The program: `watch`, the background unit that also starts the service. |
| `server.ts`        | The HTTP service: the requests above, and the origin checks.            |
| `update-socket.ts` | The WebSocket at `/power/update`: origin check, one update at a time.   |
| `update.ts`        | The update: follows the journal, runs the pull and the restart.         |
| `actions.ts`       | The fixed commands behind the power, screen and Wi-Fi requests.         |
| `nmcli.ts`         | Wi-Fi through nmcli: scanning, joining, and the messages for errors.    |
| `wifi-setup.ts`    | Serves the Wi-Fi setup page: its HTML and its two scripts.              |
| `wifi-page.ts`     | The Wi-Fi setup page itself, which runs in the browser.                 |
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
  `curl -X POST -H 'Origin: https://the-max-mix.vorkinn.org' http://127.0.0.1:7341/power/restart`.

## Tests

The Vitest suite (`npm test`) includes `pi/kiosk-audio/*.test.ts`, with `pw-dump` replies stubbed. It is type-checked
and linted with the repository's tooling rules (`tsconfig.node.json`).
