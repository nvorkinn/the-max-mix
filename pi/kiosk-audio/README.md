# THE MAX MIX audio service

A small HTTP service on the kiosk that sends the browser's sound to AirPlay speakers (Sonos and other AirPlay 2
speakers that also accept RAOP) through PipeWire. It is what the app's **AirPlay** mode under Speakers talks to. TypeScript
with Node's standard library only (no npm packages on the Pi): Node runs the `.ts` files directly, so Ansible copies
them as they are and nothing is built. That needs Node 22.18 or later, so the role installs Node
`kiosk_nodejs_major` (24, as in `.nvmrc`) from NodeSource's archive, since Debian trixie has Node 20. Its signing key
is pinned by checksum and unattended upgrades cover it.

| File             | What it is                                                                 |
| ---------------- | -------------------------------------------------------------------------- |
| `kiosk-audio.ts` | The program the systemd unit starts: arguments, the check loop, listening. |
| `service.ts`     | The HTTP API and the router that keeps the links in line with the choice.  |
| `pipewire.ts`    | `pw-dump` parsing, the link plan, and running `pw-link`.                   |

## The two playback modes

- **Spotify Connect** (the default): Spotify plays on the tablet's Web Playback SDK player, or on any Spotify Connect
  speaker it is moved to under Speakers. The Pi's sound goes to its own output and this service changes nothing.
- **AirPlay**: playback stays on the tablet's own player, and this service links Chromium's PipeWire stream to every
  AirPlay speaker picked in the app, all at once, and off the Pi's own output. Speakers can be added and removed while
  the music plays. Switching back to Spotify Connect hands the sound back to the Pi's default output.

## How it works

- `libpipewire-module-raop-discover` (enabled by `/etc/pipewire/pipewire.conf.d/50-kiosk-raop.conf`) finds RAOP
  speakers through Avahi and makes a PipeWire sink for each, with `raop.latency.ms = 500` (`kiosk_raop_latency_ms`) so
  play, pause and skip reach the speakers quickly.
- The service reads the graph with `pw-dump` (JSON: nodes, ports, links and the default sink). AirPlay sinks are the
  `Audio/Sink` nodes made by the RAOP module (`raop_sink.*`); the player is Chromium's `Stream/Output/Audio` node.
- `pw-link <output port> <input port>` connects each of the player's channels to the same channel of every chosen
  sink; `pw-link --disconnect <link>` removes its links to other sinks. New links are made before old ones go, so the
  music does not drop out. Links to anything that is not a sink (a level meter, a recorder) are left alone.
- While speakers are chosen it checks every 2 seconds, so a stream Chromium opens again, or a speaker that drops off
  the network and comes back, is routed again. If none of the chosen speakers is on the network, nothing changes.
- The choice is saved in `~/.local/state/the-max-mix/airplay.json`, so it survives a restart.

## API

| Request                                  | Answer                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /v1/airplay`                        | `{"speakers": [{"id", "nodeId", "name", "selected"}], "selected": [], "playing"}` |
| `PUT /v1/airplay` `{"speakers": ["id"]}` | The same, after routing. `[]` hands the sound back to the default output.         |

`id` is PipeWire's node name, which stays the same when a speaker comes back; `nodeId` is the current numeric id.
PipeWire being unavailable is a `503`.

## Security

- It listens on `127.0.0.1` only (`kiosk_audio_port`, 47878; the app has the same number in `src/audio/airplay.ts`).
- It answers only requests whose `Host` is that address, so a DNS rebinding page cannot reach it under another name.
- From a browser, only the app's origin (`kiosk_app_origin`) is allowed (CORS). `PUT` needs a JSON body, which makes
  the browser send a preflight first, so no other site can change the routing blind. The preflight answers Chrome's
  private network access check, and the Chromium policy `LocalNetworkAccessAllowedForUrls` lets the app's origin reach
  the loopback address without a prompt.
- Requests are small (4 KB, at most 16 speakers) and `pw-dump` and `pw-link` are run by absolute path with an argument list; no shell is involved.
- It runs as the `kiosk` user in that user's systemd session (`/etc/systemd/user/kiosk-audio.service`, started for the
  kiosk user only), next to the user's PipeWire.

## On the device

- `systemctl --user -M kiosk@ status kiosk-audio` and `journalctl _SYSTEMD_USER_UNIT=kiosk-audio.service` (as root).
- `curl -s http://127.0.0.1:47878/v1/airplay` lists the speakers; `wpctl status` shows the same sinks.

## Tests

The Vitest suite (`npm test`) includes `pi/kiosk-audio/*.test.ts`, with `pw-dump` replies stubbed and the HTTP API
called over a real loopback socket. It is type-checked and linted with the repository's tooling rules (`tsconfig.node.json`).
Run it by hand with `node pi/kiosk-audio/kiosk-audio.ts --port 47878 --origin http://127.0.0.1:5173`.
