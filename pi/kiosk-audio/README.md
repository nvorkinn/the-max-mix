# THE MAX MIX kiosk service and audio routing

A small TypeScript service that runs on the Pi as a user unit (`kiosk-audio.service`, as the `kiosk` user) and answers the
app on `127.0.0.1:7341`. It does two jobs:

- **AirPlay.** It lists the AirPlay speakers PipeWire found, and sends the kiosk browser's sound to the ones picked in the
  app (Sonos and other AirPlay 2 speakers that also accept RAOP). It is what the app's **AirPlay** mode under Speakers
  drives.
- **The kiosk buttons.** Update now, Restart kiosk, Reboot Pi, the Wi-Fi panel and waking the screen.

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

The service does not report the chosen speakers, so the app remembers them itself (`maxmix.airplaySpeakers` in its storage).

## The requests

| Request                                                 | What it does                                                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /speakers`                                         | `{"speakers": [...]}`, the AirPlay sinks, sorted                                                                                               |
| `GET /update/status`                                    | `{"state", "lines", "total"}`: how Update now is going, from the unit and `/run/kiosk/update.log` (the pull's output, written by `kiosk-pull`) |
| `POST /audio/route`                                     | Routes the sound to the speakers in the JSON body                                                                                              |
| `POST /power/update`, `/power/restart`, `/power/reboot` | Pulls the playbook now; restarts the kiosk; reboots                                                                                            |
| `POST /display/wake`                                    | Turns the screen on (`kiosk-display on`)                                                                                                       |
| `POST /wifi`                                            | Shows the Wi-Fi panel (flag file, then stops Chromium)                                                                                         |

| File             | What it is                                                              |
| ---------------- | ----------------------------------------------------------------------- |
| `kiosk-audio.ts` | The program: `watch`, the background unit that also starts the service. |
| `server.ts`      | The HTTP service: the requests above, and the origin checks.            |
| `actions.ts`     | The fixed commands behind the power, screen and Wi-Fi requests.         |
| `speakers.ts`    | Checking speaker lists, the saved choice, and routing to it.            |
| `pipewire.ts`    | `pw-dump` parsing, the link plan, and running `pw-link`.                |

It is TypeScript with Node's standard library only (no npm packages on the Pi): Node runs the `.ts` files directly, so
Ansible copies them as they are and nothing is built. That needs Node 22.18 or later, so the role installs Node
`kiosk_nodejs_major` (24, as in `.nvmrc`) from NodeSource's archive, since Debian trixie has Node 20. Its signing key is
pinned by checksum and unattended upgrades cover it.

## Security

- It listens on 127.0.0.1 only (the unit has `IPAddressDeny=any` and allows localhost). It answers the app's origin alone
  (CORS), and refuses every POST whose `Origin` header is not the app's, so no other web page can trigger an action.
- A request names a fixed action; it never carries a command. Routing accepts at most 16 speaker names of up to 256
  characters and can only link the browser's stream to existing sinks. Everything runs by absolute path with an argument
  list, no shell. polkit (`50-kiosk-power.rules`) limits what the `kiosk` user may do with systemd and power.
- Everything runs as the `kiosk` user, next to that user's PipeWire.

## On the device

- `systemctl --user -M kiosk@ status kiosk-audio` and `journalctl _SYSTEMD_USER_UNIT=kiosk-audio.service` (as root).
- `wpctl status` lists the AirPlay sinks; `pw-link -l` shows where Chromium's stream goes.
- `curl -s http://127.0.0.1:7341/speakers` lists what the app sees. A POST needs the app's `Origin`, for example
  `curl -X POST -H 'Origin: https://the-max-mix.vercel.app' http://127.0.0.1:7341/power/restart`.

## Tests

The Vitest suite (`npm test`) includes `pi/kiosk-audio/*.test.ts`, with `pw-dump` replies stubbed. It is type-checked
and linted with the repository's tooling rules (`tsconfig.node.json`).
