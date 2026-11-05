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

## How it works

1. **Discovery.** `libpipewire-module-raop-discover` (enabled by `/etc/pipewire/pipewire.conf.d/50-kiosk-raop.conf`)
   finds RAOP speakers through Avahi and makes a PipeWire sink for each, with `raop.latency.ms = 500`
   (`kiosk_raop_latency_ms`) so play, pause and skip reach the speakers quickly. The audio service
   also answers `GET http://127.0.0.1:7341/speakers` (`server.ts`, localhost only, readable by the app's origin alone) with
   the names of those sinks, and the app lists them every 5 seconds. Chromium's own device list is not used: it hides
   the names until a microphone is open, and the Pi has none.
2. **Routing.** Picking speakers sends `POST /audio/route` with `{"speakers": ["Kitchen", "Lounge"]}` (the sinks'
   descriptions). The service saves the choice in `~/.local/state/the-max-mix/speakers.json` and links each of Chromium's
   channels to the same channel of every chosen sink with `pw-link`, before removing its links to other sinks, so the
   music does not drop out. Links to anything that is not a sink (a level meter) are left alone.
3. **Keeping it there.** The `kiosk-audio` user unit (`node kiosk-audio.ts watch`) reads the saved choice every 2
   seconds and routes again when needed, so a stream Chromium opens again, or a speaker that drops off the network and
   comes back, plays in the right place. If none of the chosen speakers is on the network, nothing changes.

4. **Volume.** `GET /speakers` also gives each speaker's volume, and the drawer shows a slider under each chosen
   speaker. Moving it sends `POST /audio/volume` with `{"speaker": "Kitchen", "volume": 40}` (percent), and the
   service runs `wpctl set-volume <sink> 0.40`. The AirPlay sink passes the volume on to the speaker itself, so it is the
   same volume the speaker's own app shows. Both use wpctl's cubic scale (the cube root of PipeWire's channel volumes),
   like any volume slider.

The service does not report the chosen speakers, so the app remembers them itself (`maxmix.airplaySpeakers` in its storage).

## The watchdog

With `?kiosk=1` the app sends `POST /heartbeat` every 20 seconds while it shows something. When none has come for 3
minutes (a crashed tab, a hung page, or an app that went blank), the service stops Chromium and kiosk-session starts it
again, or shows the Wi-Fi setup page when there is no connection. The setup page sends heartbeats too. It only acts
after this service has had a heartbeat, and gives every new Chromium the full 3 minutes; each restart without a heartbeat in between
doubles the wait (up to an hour), so a page that cannot load is not restarted in a loop. The app also sends its errors
to `POST /log` (at most 30 lines a minute reach the journal). Both are in the journal:
`journalctl _SYSTEMD_USER_UNIT=kiosk-audio.service` (as root), lines starting `app` or `No heartbeat`.

## The requests

| Request                                | What it does                                                |
| -------------------------------------- | ----------------------------------------------------------- |
| `GET /speakers`                        | `{"speakers": [...], "volumes": {"Kitchen": 40}}`           |
| `POST /audio/route`                    | Routes the sound to the speakers in the JSON body           |
| `POST /audio/volume`                   | Sets one speaker's volume (404: not on the network)         |
| `WS /power/update`                     | Connecting starts the update and streams it (below)         |
| `POST /power/restart`, `/power/reboot` | Restarts the kiosk; reboots                                 |
| `POST /display/wake`                   | Turns the screen on (`kiosk-display on`)                    |
| `POST /wifi`                           | Shows the Wi-Fi setup page (flag file, then stops Chromium) |
| `POST /heartbeat`                      | The app is alive (the watchdog, below)                      |
| `POST /log`                            | An app error, written to the journal                        |
| `GET /wifi/networks`                   | The Wi-Fi networks in range, strongest first                |
| `POST /wifi/connect`                   | Joins one (`{"ssid", "password", "hidden", "security"}`)    |
| `POST /wifi/done`                      | The setup page is finished: stops the Chromium showing it   |
| `GET /wifi-setup`                      | The Wi-Fi setup page, and its scripts under `/wifi-setup/`  |

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

- It listens on 127.0.0.1 only (the unit has `IPAddressDeny=any` and allows localhost). It answers the app's origin alone
  (CORS), and refuses every POST and every WebSocket whose `Origin` header is not the app's (a browser does not apply CORS
  to a WebSocket), so no other web page can trigger an action.
- A request names a fixed action; it never carries a command. Routing accepts at most 16 speaker names of up to 256
  characters and can only link the browser's stream to existing sinks. Everything runs by absolute path with an argument
  list, no shell. polkit (`50-kiosk-power.rules`) limits what the `kiosk` user may do with systemd and power.
- Everything runs as the `kiosk` user, next to that user's PipeWire.

## On the device

- `systemctl --user -M kiosk@ status kiosk-audio` and `journalctl _SYSTEMD_USER_UNIT=kiosk-audio.service` (as root).
- `wpctl status` lists the AirPlay sinks; `pw-link -l` shows where Chromium's stream goes; `wpctl get-volume <id>`
  shows a speaker's volume as the app does.
- `curl -s http://127.0.0.1:7341/speakers` lists what the app sees. A POST needs the app's `Origin`, for example
  `curl -X POST -H 'Origin: https://the-max-mix.vercel.app' http://127.0.0.1:7341/power/restart`.

## Tests

The Vitest suite (`npm test`) includes `pi/kiosk-audio/*.test.ts`, with `pw-dump` replies stubbed. It is type-checked
and linted with the repository's tooling rules (`tsconfig.node.json`).
